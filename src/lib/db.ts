/**
 * PostgreSQL database layer. Replaces JSON file persistence.
 */
import pg from 'pg';
import type { NodeData, Edge, Comment, GraphData } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.ZYGOMORPHIC_DB_URL
        ?? 'postgresql://rhizome@localhost/zygomorphic',
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---- Schema ----------------------------------------------------------------

export async function initSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      node_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      node_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_edges_a ON edges(node_a);
    CREATE INDEX IF NOT EXISTS idx_edges_b ON edges(node_b);
    CREATE INDEX IF NOT EXISTS idx_comments_node ON comments(node_id);
    CREATE INDEX IF NOT EXISTS idx_comments_expires ON comments(expires_at)
      WHERE expires_at IS NOT NULL;
  `);
}

// ---- Nodes -----------------------------------------------------------------

export async function loadFullGraph(): Promise<GraphData> {
  const db = getPool();
  const nodeRows = await db.query('SELECT * FROM nodes');
  const edgeRows = await db.query('SELECT * FROM edges');

  const nodes: Record<string, NodeData> = {};
  for (const r of nodeRows.rows) {
    nodes[r.id] = {
      id: r.id,
      content: r.content,
      summary: r.summary,
      exploration: [],
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }

  const edges: Record<string, Edge> = {};
  for (const r of edgeRows.rows) {
    edges[r.id] = {
      id: r.id,
      a: r.node_a,
      b: r.node_b,
      label: r.label,
      created_at: r.created_at.toISOString(),
    };
  }

  return { nodes, edges };
}

export async function getNode(id: string): Promise<NodeData | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM nodes WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    content: r.content,
    summary: r.summary,
    exploration: [],
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function insertNode(node: NodeData): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO nodes (id, content, summary, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [node.id, node.content, node.summary, node.created_at, node.updated_at],
  );
}

export async function updateNode(
  id: string, content: string, summary: string,
): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE nodes SET content = $2, summary = $3, updated_at = now() WHERE id = $1`,
    [id, content, summary],
  );
}

export async function deleteNode(id: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM nodes WHERE id = $1', [id]);
  // Edges and comments cascade via ON DELETE CASCADE
}

// ---- Edges -----------------------------------------------------------------

export async function insertEdge(edge: Edge): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO edges (id, node_a, node_b, label, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [edge.id, edge.a, edge.b, edge.label, edge.created_at],
  );
}

export async function deleteEdge(id: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM edges WHERE id = $1', [id]);
}

// ---- Comments --------------------------------------------------------------

export async function getComments(nodeId: string): Promise<Comment[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT * FROM comments
     WHERE node_id = $1
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at ASC`,
    [nodeId],
  );
  return rows.map((r) => ({
    id: r.id,
    node_id: r.node_id,
    content: r.content,
    author: r.author,
    created_at: r.created_at.toISOString(),
    expires_at: r.expires_at ? r.expires_at.toISOString() : null,
  }));
}

export async function insertComment(comment: Comment): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO comments (id, node_id, content, author, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [comment.id, comment.node_id, comment.content, comment.author,
     comment.created_at, comment.expires_at],
  );
}

export async function deleteExpiredComments(): Promise<number> {
  const db = getPool();
  const { rowCount } = await db.query(
    'DELETE FROM comments WHERE expires_at IS NOT NULL AND expires_at <= now()',
  );
  return rowCount ?? 0;
}

// ---- Search ----------------------------------------------------------------

export async function searchNodes(query: string): Promise<NodeData[]> {
  const db = getPool();
  const pattern = `%${query}%`;
  const { rows } = await db.query(
    `SELECT * FROM nodes
     WHERE content ILIKE $1 OR summary ILIKE $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [pattern],
  );
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    summary: r.summary,
    exploration: [],
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));
}

// ---- Poll ------------------------------------------------------------------

export interface PollResult {
  nodeCount: number;
  edgeCount: number;
  nodesMaxUpdated: string | null;
  focusNodeUpdated: string | null;
  focusCommentCount: number;
}

export async function poll(focusNodeId: string | null): Promise<PollResult> {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM nodes) AS node_count,
      (SELECT COUNT(*)::int FROM edges) AS edge_count,
      (SELECT MAX(updated_at) FROM nodes) AS nodes_max_updated,
      (SELECT updated_at FROM nodes WHERE id = $1) AS focus_node_updated,
      (SELECT COUNT(*)::int FROM comments
       WHERE node_id = $1 AND (expires_at IS NULL OR expires_at > now())) AS focus_comment_count
  `, [focusNodeId]);
  const r = rows[0];
  return {
    nodeCount: r.node_count,
    edgeCount: r.edge_count,
    nodesMaxUpdated: r.nodes_max_updated ? r.nodes_max_updated.toISOString() : null,
    focusNodeUpdated: r.focus_node_updated ? r.focus_node_updated.toISOString() : null,
    focusCommentCount: r.focus_comment_count,
  };
}

// ---- Neighborhood ----------------------------------------------------------

export async function getNeighborhood(id: string): Promise<{
  node: NodeData | null;
  edges: Edge[];
  neighbors: Record<string, NodeData>;
}> {
  const db = getPool();

  const nodeResult = await getNode(id);
  if (!nodeResult) return { node: null, edges: [], neighbors: {} };

  const { rows: edgeRows } = await db.query(
    `SELECT * FROM edges WHERE node_a = $1 OR node_b = $1`,
    [id],
  );

  const edges: Edge[] = edgeRows.map((r) => ({
    id: r.id,
    a: r.node_a,
    b: r.node_b,
    label: r.label,
    created_at: r.created_at.toISOString(),
  }));

  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.a !== id) neighborIds.add(e.a);
    if (e.b !== id) neighborIds.add(e.b);
  }

  const neighbors: Record<string, NodeData> = {};
  if (neighborIds.size > 0) {
    const ids = [...neighborIds];
    const { rows } = await db.query(
      `SELECT * FROM nodes WHERE id = ANY($1)`,
      [ids],
    );
    for (const r of rows) {
      neighbors[r.id] = {
        id: r.id,
        content: r.content,
        summary: r.summary,
        exploration: [],
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      };
    }
  }

  return { node: nodeResult, edges, neighbors };
}
