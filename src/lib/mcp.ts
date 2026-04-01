/**
 * MCP server exposing graph navigation and mutation tools.
 *
 * Agents interact with the graph through these tools. Each tool
 * delegates to the orchestrator's state machine via dispatch().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { GraphData, NodeData, Edge } from './types.js';
import type { AppEvent } from './state.js';

// ---------------------------------------------------------------------------
// Graph accessor
// ---------------------------------------------------------------------------

let _graph: GraphData | null = null;
let _dispatch: ((event: AppEvent) => void | Promise<void>) | null = null;

export function setGraph(graph: GraphData | null): void { _graph = graph; }
export function setDispatch(fn: (event: AppEvent) => void | Promise<void>): void { _dispatch = fn; }

function graph(): GraphData {
  if (!_graph) throw new Error('No graph loaded');
  return _graph;
}

async function dispatch(event: AppEvent): Promise<void> {
  if (!_dispatch) throw new Error('No dispatch function set');
  await _dispatch(event);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId(prefix = 'n'): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// Neighborhood BFS (direction-agnostic)
// ---------------------------------------------------------------------------

interface LeveledNode { id: string; level: number; }

function collectNeighborhood(g: GraphData, focalId: string, maxDepth: number): {
  nodes: LeveledNode[];
  edges: Edge[];
} {
  const visited = new Set<string>([focalId]);
  const result: LeveledNode[] = [];
  const relevantEdges: Edge[] = [];
  let frontier = [focalId];

  for (let level = 1; level <= maxDepth && frontier.length > 0; level++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const edge of Object.values(g.edges)) {
        let neighbor: string | null = null;
        if (edge.a === id) neighbor = edge.b;
        else if (edge.b === id) neighbor = edge.a;
        if (neighbor && !visited.has(neighbor) && g.nodes[neighbor]) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
          result.push({ id: neighbor, level });
        }
        // Collect edge if it touches the focal or any visited node
        if (neighbor !== null && !relevantEdges.includes(edge)) {
          relevantEdges.push(edge);
        }
      }
    }
    frontier = nextFrontier;
  }

  return { nodes: result, edges: relevantEdges };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'zygomorphic',
    version: '0.2.0',
  });

  // ---- get_overview --------------------------------------------------------
  server.tool(
    'get_overview',
    'Summary of the entire graph: all nodes with summaries',
    {},
    async () => {
      const g = graph();
      const entries = Object.values(g.nodes);
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'Graph is empty' }] };
      }

      const lines = entries.map((n) => `- [${n.id}] ${n.summary}`);
      const edgeCount = Object.keys(g.edges).length;
      const text = `Graph: ${entries.length} nodes, ${edgeCount} edges\n\n${lines.join('\n')}`;
      return { content: [{ type: 'text', text }] };
    },
  );

  // ---- get_node ------------------------------------------------------------
  server.tool(
    'get_node',
    'Full content, metadata, edges, and exploration for a node',
    { id: z.string().describe('Node ID') },
    async ({ id }) => {
      const g = graph();
      const node = g.nodes[id];
      if (!node) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };

      const edges = Object.values(g.edges).filter((e) => e.a === id || e.b === id);
      const edgeLines = edges.map((e) => {
        const other = e.a === id ? e.b : e.a;
        const otherNode = g.nodes[other];
        return `  ${e.label} → [${other}] ${otherNode?.summary ?? '(missing)'}`;
      });

      const sections = [
        `[${id}] ${node.summary}`,
        `\nContent:\n${node.content}`,
      ];

      if (edgeLines.length > 0) {
        sections.push(`\nEdges (${edgeLines.length}):\n${edgeLines.join('\n')}`);
      }

      if (node.exploration.length > 0) {
        const entries = node.exploration.map((e) => {
          const conclusion = e.conclusion ? ` — ${e.conclusion}` : '';
          return `  ${e.agent} @ ${new Date(e.timestamp).toISOString()}${conclusion}`;
        });
        sections.push(`\nExploration:\n${entries.join('\n')}`);
      }

      return { content: [{ type: 'text', text: sections.join('\n') }] };
    },
  );

  // ---- get_neighborhood ----------------------------------------------------
  server.tool(
    'get_neighborhood',
    'Focal node plus N hops of neighbors (direction-agnostic BFS)',
    {
      id: z.string().describe('Focal node ID'),
      depth: z.number().int().min(1).max(10).default(2).describe('Hops from focal'),
    },
    async ({ id, depth }) => {
      const g = graph();
      const focal = g.nodes[id];
      if (!focal) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };

      const { nodes: neighbors } = collectNeighborhood(g, id, depth);

      const sections: string[] = [];
      sections.push(`## Focus: [${id}]`);
      sections.push(focal.summary);
      sections.push(`\nContent:\n${focal.content}`);

      if (neighbors.length > 0) {
        sections.push(`\n## Neighbors (${neighbors.length})`);
        for (const nb of neighbors) {
          const n = g.nodes[nb.id];
          const indent = '  '.repeat(nb.level - 1);
          sections.push(`${indent}[${nb.id}] (hop ${nb.level}) ${n?.summary ?? '(missing)'}`);
        }
      }

      return { content: [{ type: 'text', text: sections.join('\n') }] };
    },
  );

  // ---- search --------------------------------------------------------------
  server.tool(
    'search',
    'Keyword search across node content and summaries',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }) => {
      const g = graph();
      const lowerQ = query.toLowerCase();

      const results = Object.values(g.nodes)
        .map((node) => {
          const inContent = node.content.toLowerCase().includes(lowerQ);
          const inSummary = node.summary.toLowerCase().includes(lowerQ);
          if (!inContent && !inSummary) return null;
          return { id: node.id, summary: node.summary, matchIn: inContent && inSummary ? 'both' : inContent ? 'content' : 'summary' };
        })
        .filter(Boolean);

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No results for '${query}'` }] };
      }

      const lines = results.map((r) => `- [${r!.id}] (${r!.matchIn}) ${r!.summary}`);
      return { content: [{ type: 'text', text: `${results.length} results:\n${lines.join('\n')}` }] };
    },
  );

  // ---- create_node ---------------------------------------------------------
  server.tool(
    'create_node',
    'Create a new node, optionally connected to another node via a labeled edge',
    {
      content: z.string().describe('Node content'),
      summary: z.string().optional().describe('Summary (auto-truncated from content if omitted)'),
      connect_to: z.string().optional().describe('Node ID to connect to via an edge'),
      edge_label: z.string().optional().describe('Label for the connecting edge'),
    },
    async ({ content, summary, connect_to, edge_label }) => {
      const g = graph();
      if (connect_to && !g.nodes[connect_to]) {
        return { content: [{ type: 'text', text: `Node '${connect_to}' not found` }], isError: true };
      }

      const now = new Date().toISOString();
      const id = nextId('n');
      const node: NodeData = {
        id,
        content,
        summary: summary ?? content.slice(0, 120),
        exploration: [],
        created_at: now,
        updated_at: now,
      };

      await dispatch({ type: 'NODE_CREATED', node });

      if (connect_to) {
        const edge: Edge = {
          id: nextId('e'),
          a: id,
          b: connect_to,
          label: edge_label ?? 'related',
          created_at: now,
        };
        await dispatch({ type: 'EDGE_CREATED', edge });
      }

      return { content: [{ type: 'text', text: `Created node ${id}` }] };
    },
  );

  // ---- update_node ---------------------------------------------------------
  server.tool(
    'update_node',
    'Update a node\'s content and/or summary',
    {
      id: z.string().describe('Node ID'),
      content: z.string().describe('New content'),
      summary: z.string().optional().describe('New summary (auto-truncated if omitted)'),
    },
    async ({ id, content, summary }) => {
      if (!graph().nodes[id]) {
        return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };
      }

      await dispatch({
        type: 'NODE_UPDATED',
        nodeId: id,
        content,
        summary: summary ?? content.slice(0, 120),
      });
      return { content: [{ type: 'text', text: `Updated node ${id}` }] };
    },
  );

  // ---- create_edge ---------------------------------------------------------
  server.tool(
    'create_edge',
    'Create an undirected labeled edge between two nodes',
    {
      a: z.string().describe('First node ID'),
      b: z.string().describe('Second node ID'),
      label: z.string().describe('Edge label (e.g. "related", "contains", "depends_on")'),
    },
    async ({ a, b, label }) => {
      const g = graph();
      if (!g.nodes[a]) return { content: [{ type: 'text', text: `Node '${a}' not found` }], isError: true };
      if (!g.nodes[b]) return { content: [{ type: 'text', text: `Node '${b}' not found` }], isError: true };

      const edge: Edge = {
        id: nextId('e'),
        a,
        b,
        label,
        created_at: new Date().toISOString(),
      };
      await dispatch({ type: 'EDGE_CREATED', edge });
      return { content: [{ type: 'text', text: `Created edge ${edge.id}: ${a} —[${label}]— ${b}` }] };
    },
  );

  // ---- delete_edge ---------------------------------------------------------
  server.tool(
    'delete_edge',
    'Remove an edge by ID',
    { edge_id: z.string().describe('Edge ID') },
    async ({ edge_id }) => {
      const g = graph();
      if (!g.edges[edge_id]) return { content: [{ type: 'text', text: `Edge '${edge_id}' not found` }], isError: true };
      await dispatch({ type: 'EDGE_DELETED', edgeId: edge_id });
      return { content: [{ type: 'text', text: `Deleted edge ${edge_id}` }] };
    },
  );

  // ---- add_comment ---------------------------------------------------------
  server.tool(
    'add_comment',
    'Add an ephemeral comment on a node',
    {
      node_id: z.string().describe('Node ID to comment on'),
      content: z.string().describe('Comment text'),
      author: z.string().describe('Author identifier (agent name or "human")'),
      expires_in_hours: z.number().optional().describe('Hours until comment expires (null = permanent)'),
    },
    async ({ node_id, content: text, author, expires_in_hours }) => {
      if (!graph().nodes[node_id]) {
        return { content: [{ type: 'text', text: `Node '${node_id}' not found` }], isError: true };
      }

      const now = new Date();
      const expiresAt = expires_in_hours
        ? new Date(now.getTime() + expires_in_hours * 3600_000).toISOString()
        : null;

      await dispatch({
        type: 'COMMENT_ADDED',
        comment: {
          id: nextId('c'),
          node_id,
          content: text,
          author,
          created_at: now.toISOString(),
          expires_at: expiresAt,
        },
      });
      return { content: [{ type: 'text', text: `Comment added on ${node_id}` }] };
    },
  );

  // ---- record_exploration ---------------------------------------------------
  server.tool(
    'record_exploration',
    'Record that an agent visited a node, with an optional conclusion',
    {
      id: z.string().describe('Node ID that was explored'),
      agent: z.string().describe('Agent identifier'),
      conclusion: z.string().optional().describe('What was found or concluded'),
    },
    async ({ id, agent, conclusion }) => {
      if (!graph().nodes[id]) {
        return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };
      }

      await dispatch({
        type: 'EXPLORATION_UPDATED',
        nodeId: id,
        entry: { agent, timestamp: Date.now(), conclusion },
      });
      return { content: [{ type: 'text', text: `Recorded exploration of ${id} by ${agent}` }] };
    },
  );

  // ---- get_exploration_state -----------------------------------------------
  server.tool(
    'get_exploration_state',
    'What has been visited, by whom, and what was concluded',
    {},
    async () => {
      const g = graph();
      const explored: string[] = [];

      for (const [id, node] of Object.entries(g.nodes)) {
        if (node.exploration.length > 0) {
          const entries = node.exploration.map((e) => {
            const conclusion = e.conclusion ? ` — ${e.conclusion}` : '';
            return `  ${e.agent} @ ${new Date(e.timestamp).toISOString()}${conclusion}`;
          });
          explored.push(`[${id}] ${node.summary}\n${entries.join('\n')}`);
        }
      }

      if (explored.length === 0) {
        return { content: [{ type: 'text', text: 'No exploration recorded yet' }] };
      }

      return { content: [{ type: 'text', text: explored.join('\n\n') }] };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Standalone stdio entrypoint
// ---------------------------------------------------------------------------

export async function startStdioServer(
  graph: GraphData,
  dispatchFn: (event: AppEvent) => void | Promise<void>,
): Promise<void> {
  setGraph(graph);
  setDispatch(dispatchFn);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
