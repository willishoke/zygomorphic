/**
 * Store: markdown files as truth, SQLite as derived index.
 *
 * Layout inside .zygomorphic/:
 *   src/lib/db.ts   → src/lib/db.ts.md      (file node)
 *   src/lib/        → src/lib/_dir.md        (directory node)
 *   ./              → _dir.md                (workspace root node)
 *
 * Frontmatter keys: role, assessed_at_commit, created_at, updated_at
 * Body: detail (free-form markdown)
 *
 * SQLite lives at .zygomorphic/.index.db and is gitignored.
 * Exploration entries are SQLite-only (ephemeral, not committed).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { NodeData, ExplorationEntry, TreeData } from './types.js';

export const STORE_DIR = '.zygomorphic';
const DB_FILENAME = '.index.db';

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

type Frontmatter = Record<string, string>;

function parseMd(raw: string): { fm: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fm, body: match[2].trim() };
}

function stringifyMd(fm: Frontmatter, body: string): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------

/** Relative path within .zygomorphic/ for a given node */
function mdRelPath(nodePath: string, isLeaf: boolean): string {
  if (!isLeaf) {
    return nodePath === '.' ? '_dir.md' : `${nodePath}/_dir.md`;
  }
  return `${nodePath}.md`;
}

/** Parse a .md path (relative to .zygomorphic/) back to node info */
function mdRelToNode(rel: string): { nodePath: string; isLeaf: boolean } | null {
  if (rel === '_dir.md') return { nodePath: '.', isLeaf: false };
  if (rel.endsWith('/_dir.md')) {
    return { nodePath: rel.slice(0, -'/_dir.md'.length), isLeaf: false };
  }
  if (rel.endsWith('.md')) {
    return { nodePath: rel.slice(0, -3), isLeaf: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Derive tree structure from a list of paths
// ---------------------------------------------------------------------------

function deriveTree(
  paths: { path: string; isLeaf: boolean }[],
): Record<string, Omit<NodeData, 'role' | 'detail' | 'assessed_at_commit' | 'exploration' | 'created_at' | 'updated_at'>> {
  const nodes: Record<string, ReturnType<typeof deriveTree>[string]> = {};

  // Ensure root exists
  nodes['.'] = { id: '.', path: '.', name: '.', parent_id: null, is_leaf: false, depth: 0 };

  for (const { path: p, isLeaf } of paths) {
    const parts = p.split('/');
    const name = parts[parts.length - 1];
    const depth = parts.length;
    const parent = parts.length === 1 ? '.' : parts.slice(0, -1).join('/');
    nodes[p] = { id: p, path: p, name, parent_id: parent, is_leaf: isLeaf, depth };
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class Store {
  private db: Database.Database;

  constructor(readonly workspaceRoot: string) {
    fs.mkdirSync(this.storeRoot, { recursive: true });
    this.db = new Database(path.join(this.storeRoot, DB_FILENAME));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  get storeRoot(): string {
    return path.join(this.workspaceRoot, STORE_DIR);
  }

  // ---- Schema --------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id                  TEXT PRIMARY KEY,
        path                TEXT UNIQUE NOT NULL,
        name                TEXT NOT NULL,
        parent_id           TEXT,
        is_leaf             INTEGER NOT NULL DEFAULT 1,
        depth               INTEGER NOT NULL DEFAULT 0,
        role                TEXT,
        detail              TEXT,
        assessed_at_commit  TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exploration (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        agent     TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        conclusion TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        path, name, role, detail,
        content='nodes',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS nodes_fts_insert
        AFTER INSERT ON nodes BEGIN
          INSERT INTO nodes_fts(rowid, path, name, role, detail)
          VALUES (new.rowid, new.path, new.name, new.role, new.detail);
        END;

      CREATE TRIGGER IF NOT EXISTS nodes_fts_delete
        AFTER DELETE ON nodes BEGIN
          INSERT INTO nodes_fts(nodes_fts, rowid, path, name, role, detail)
          VALUES ('delete', old.rowid, old.path, old.name, old.role, old.detail);
        END;

      CREATE TRIGGER IF NOT EXISTS nodes_fts_update
        AFTER UPDATE ON nodes BEGIN
          INSERT INTO nodes_fts(nodes_fts, rowid, path, name, role, detail)
          VALUES ('delete', old.rowid, old.path, old.name, old.role, old.detail);
          INSERT INTO nodes_fts(rowid, path, name, role, detail)
          VALUES (new.rowid, new.path, new.name, new.role, new.detail);
        END;
    `);
  }

  // ---- Index build ---------------------------------------------------------

  /**
   * Rebuild the SQLite index by merging the live file tree with any existing
   * assessment data from .zygomorphic/*.md files.
   */
  rebuildIndex(filePaths: { path: string; isLeaf: boolean }[]): void {
    const structure = deriveTree(filePaths);
    const now = new Date().toISOString();

    const upsert = this.db.prepare(`
      INSERT INTO nodes (id, path, name, parent_id, is_leaf, depth, role, detail, assessed_at_commit, created_at, updated_at)
      VALUES (@id, @path, @name, @parent_id, @is_leaf, @depth, @role, @detail, @assessed_at_commit, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name               = excluded.name,
        parent_id          = excluded.parent_id,
        is_leaf            = excluded.is_leaf,
        depth              = excluded.depth,
        role               = excluded.role,
        detail             = excluded.detail,
        assessed_at_commit = excluded.assessed_at_commit,
        updated_at         = excluded.updated_at
    `);

    // Remove nodes that no longer exist in the file tree
    const currentIds = new Set(['.', ...filePaths.map((f) => f.path)]);
    const existing = this.db.prepare('SELECT id FROM nodes').all() as { id: string }[];
    const deleteStmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');

    const rebuild = this.db.transaction(() => {
      for (const { id } of existing) {
        if (!currentIds.has(id)) deleteStmt.run(id);
      }

      for (const [id, base] of Object.entries(structure)) {
        const assessment = this.readMd(id, base.is_leaf);
        upsert.run({
          id,
          path: base.path,
          name: base.name,
          parent_id: base.parent_id,
          is_leaf: base.is_leaf ? 1 : 0,
          depth: base.depth,
          role: assessment?.role ?? null,
          detail: assessment?.detail ?? null,
          assessed_at_commit: assessment?.assessed_at_commit ?? null,
          created_at: assessment?.created_at ?? now,
          updated_at: assessment?.updated_at ?? now,
        });
      }
    });

    rebuild();
  }

  // ---- Markdown file I/O ---------------------------------------------------

  private mdAbsPath(nodePath: string, isLeaf: boolean): string {
    return path.join(this.storeRoot, mdRelPath(nodePath, isLeaf));
  }

  private readMd(
    nodePath: string,
    isLeaf: boolean,
  ): Pick<NodeData, 'role' | 'detail' | 'assessed_at_commit' | 'created_at' | 'updated_at'> | null {
    const absPath = this.mdAbsPath(nodePath, isLeaf);
    if (!fs.existsSync(absPath)) return null;
    const { fm, body } = parseMd(fs.readFileSync(absPath, 'utf8'));
    return {
      role: fm['role'] || null,
      detail: body || null,
      assessed_at_commit: fm['assessed_at_commit'] || null,
      created_at: fm['created_at'] || new Date().toISOString(),
      updated_at: fm['updated_at'] || new Date().toISOString(),
    };
  }

  private writeMd(node: NodeData): void {
    const absPath = this.mdAbsPath(node.path, node.is_leaf);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const fm: Frontmatter = {};
    if (node.role) fm['role'] = node.role;
    if (node.assessed_at_commit) fm['assessed_at_commit'] = node.assessed_at_commit;
    fm['created_at'] = node.created_at;
    fm['updated_at'] = node.updated_at;
    fs.writeFileSync(absPath, stringifyMd(fm, node.detail ?? ''));
  }

  // ---- Query ---------------------------------------------------------------

  getTree(): TreeData {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY depth, path').all() as NodeData[];
    const nodes: Record<string, NodeData> = {};
    for (const row of rows) {
      nodes[row.id] = {
        ...row,
        is_leaf: Boolean((row as any).is_leaf),
        exploration: this.getExplorationForNode(row.id),
      };
    }
    return { root_id: '.', nodes };
  }

  getNode(id: string): NodeData | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeData | undefined;
    if (!row) return null;
    return {
      ...row,
      is_leaf: Boolean((row as any).is_leaf),
      exploration: this.getExplorationForNode(id),
    };
  }

  getChildren(id: string): NodeData[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY is_leaf DESC, name').all(id) as NodeData[];
    return rows.map((r) => ({ ...r, is_leaf: Boolean((r as any).is_leaf), exploration: [] }));
  }

  search(query: string): NodeData[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts ON nodes_fts.rowid = n.rowid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).all(query) as NodeData[];
    return rows.map((r) => ({ ...r, is_leaf: Boolean((r as any).is_leaf), exploration: [] }));
  }

  getStale(headCommit: string | null, limit = 50): NodeData[] {
    const rows = headCommit
      ? this.db.prepare(
          'SELECT * FROM nodes WHERE assessed_at_commit IS NULL OR assessed_at_commit != ? ORDER BY depth, path LIMIT ?',
        ).all(headCommit, limit)
      : this.db.prepare('SELECT * FROM nodes WHERE assessed_at_commit IS NULL ORDER BY depth, path LIMIT ?').all(limit);
    return (rows as NodeData[]).map((r) => ({ ...r, is_leaf: Boolean((r as any).is_leaf), exploration: [] }));
  }

  // ---- Writes --------------------------------------------------------------

  assessNode(id: string, role: string, detail: string, commit: string | null): NodeData {
    const existing = this.getNode(id);
    if (!existing) throw new Error(`Node '${id}' not found`);

    const now = new Date().toISOString();
    const updated: NodeData = {
      ...existing,
      role,
      detail,
      assessed_at_commit: commit,
      created_at: existing.created_at,
      updated_at: now,
    };

    this.writeMd(updated);
    this.db.prepare(`
      UPDATE nodes SET role = ?, detail = ?, assessed_at_commit = ?, updated_at = ? WHERE id = ?
    `).run(role, detail, commit, now, id);

    return updated;
  }

  // ---- Exploration (SQLite-only, ephemeral) --------------------------------

  recordExploration(nodeId: string, agent: string, conclusion?: string): void {
    this.db.prepare(
      'INSERT INTO exploration (node_id, agent, timestamp, conclusion) VALUES (?, ?, ?, ?)',
    ).run(nodeId, agent, Date.now(), conclusion ?? null);
  }

  private getExplorationForNode(nodeId: string): ExplorationEntry[] {
    return (
      this.db.prepare('SELECT agent, timestamp, conclusion FROM exploration WHERE node_id = ? ORDER BY timestamp').all(nodeId) as ExplorationEntry[]
    );
  }

  getAllExploration(): Record<string, ExplorationEntry[]> {
    const rows = this.db.prepare(
      'SELECT node_id, agent, timestamp, conclusion FROM exploration ORDER BY timestamp',
    ).all() as (ExplorationEntry & { node_id: string })[];

    const result: Record<string, ExplorationEntry[]> = {};
    for (const { node_id, ...entry } of rows) {
      (result[node_id] ??= []).push(entry);
    }
    return result;
  }
}
