/**
 * MCP server exposing graph navigation and mutation tools.
 *
 * Agents interact with the graph through these 10 tools. Each tool
 * delegates to the orchestrator's state machine via dispatch().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { GraphData, NodeData } from './types.js';
import type { AppEvent } from './state.js';

// ---------------------------------------------------------------------------
// Graph accessor — the MCP server reads from and writes to this reference.
// Call setGraph() to wire it up to the orchestrator's live state.
// ---------------------------------------------------------------------------

let _graph: GraphData | null = null;
let _dispatch: ((event: AppEvent) => void) | null = null;

export function setGraph(graph: GraphData | null): void { _graph = graph; }
export function setDispatch(fn: (event: AppEvent) => void): void { _dispatch = fn; }

function graph(): GraphData {
  if (!_graph) throw new Error('No graph loaded');
  return _graph;
}

function dispatch(event: AppEvent): void {
  if (!_dispatch) throw new Error('No dispatch function set');
  _dispatch(event);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId(): string {
  return `n_${Date.now()}_${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'zygomorphic',
    version: '0.1.0',
  });

  // ---- get_overview --------------------------------------------------------
  server.tool(
    'get_overview',
    'Top-level summary of the entire graph',
    {},
    async () => {
      const g = graph();
      const rootSummaries = g.root_ids
        .map((id) => {
          const node = g.nodes[id];
          return node ? `- [${id}] ${node.summary}` : `- [${id}] (missing)`;
        })
        .join('\n');

      const nodeCount = Object.keys(g.nodes).length;
      const text = `Graph: ${nodeCount} nodes, ${g.root_ids.length} roots\n\n${rootSummaries}`;
      return { content: [{ type: 'text', text }] };
    },
  );

  // ---- get_node ------------------------------------------------------------
  server.tool(
    'get_node',
    'Full content and metadata for a specific node',
    { id: z.string().describe('Node ID') },
    async ({ id }) => {
      const node = graph().nodes[id];
      if (!node) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
    },
  );

  // ---- list_children -------------------------------------------------------
  server.tool(
    'list_children',
    'One level of children with their summaries',
    { id: z.string().describe('Parent node ID') },
    async ({ id }) => {
      const g = graph();
      const node = g.nodes[id];
      if (!node) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };

      if (node.children.length === 0) {
        return { content: [{ type: 'text', text: `Node '${id}' has no children (leaf node)` }] };
      }

      const lines = node.children.map((cid) => {
        const child = g.nodes[cid];
        return child ? `- [${cid}] ${child.summary}` : `- [${cid}] (missing)`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ---- get_neighborhood ----------------------------------------------------
  server.tool(
    'get_neighborhood',
    'Focal node plus N levels of ancestors and descendants with summaries',
    {
      id: z.string().describe('Focal node ID'),
      depth: z.number().int().min(1).max(10).default(2).describe('Levels in each direction'),
    },
    async ({ id, depth }) => {
      const g = graph();
      const focal = g.nodes[id];
      if (!focal) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };

      const ancestors = collectAncestors(g, id, depth);
      const descendants = collectDescendants(g, id, depth);

      const sections: string[] = [];

      if (ancestors.length > 0) {
        sections.push('## Ancestors');
        for (const a of ancestors) {
          const n = g.nodes[a.id];
          sections.push(`${'  '.repeat(a.level)}[${a.id}] ${n?.summary ?? '(missing)'}`);
        }
      }

      sections.push(`\n## Focus: [${id}]`);
      sections.push(focal.summary);
      sections.push(`\nContent:\n${focal.content}`);

      if (descendants.length > 0) {
        sections.push('\n## Descendants');
        for (const d of descendants) {
          const n = g.nodes[d.id];
          sections.push(`${'  '.repeat(d.level)}[${d.id}] ${n?.summary ?? '(missing)'}`);
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
      scope: z.string().optional().describe('Scope to a subtree rooted at this node ID'),
    },
    async ({ query, scope }) => {
      const g = graph();
      const lowerQ = query.toLowerCase();

      let nodeIds = Object.keys(g.nodes);
      if (scope) {
        const scopeIds = new Set<string>();
        collectAllDescendantIds(g, scope, scopeIds);
        scopeIds.add(scope);
        nodeIds = nodeIds.filter((id) => scopeIds.has(id));
      }

      const results = nodeIds
        .map((id) => {
          const node = g.nodes[id]!;
          const inContent = node.content.toLowerCase().includes(lowerQ);
          const inSummary = node.summary.toLowerCase().includes(lowerQ);
          if (!inContent && !inSummary) return null;
          return { id, summary: node.summary, matchIn: inContent && inSummary ? 'both' : inContent ? 'content' : 'summary' };
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
    'Create a new node. Summary is generated automatically if not provided.',
    {
      parent_id: z.string().optional().describe('Parent node ID (omit for root node)'),
      content: z.string().describe('Node content'),
      summary: z.string().optional().describe('Summary (auto-generated if omitted)'),
    },
    async ({ parent_id, content, summary }) => {
      const g = graph();
      if (parent_id && !g.nodes[parent_id]) {
        return { content: [{ type: 'text', text: `Parent '${parent_id}' not found` }], isError: true };
      }

      const id = nextId();
      const parentNode = parent_id ? g.nodes[parent_id] : null;

      const node: NodeData = {
        id,
        content,
        summary: summary ?? content.slice(0, 120),
        parent_ids: parent_id ? [parent_id] : [],
        children: [],
        links: [],
        depth: parentNode ? parentNode.depth + 1 : 0,
        exploration: [],
      };

      dispatch({ type: 'NODE_CREATED', node });
      return { content: [{ type: 'text', text: `Created node ${id}` }] };
    },
  );

  // ---- update_node ---------------------------------------------------------
  server.tool(
    'update_node',
    'Update a node\'s content. Triggers summary regeneration.',
    {
      id: z.string().describe('Node ID'),
      content: z.string().describe('New content'),
      summary: z.string().optional().describe('New summary (auto-generated if omitted)'),
    },
    async ({ id, content, summary }) => {
      if (!graph().nodes[id]) {
        return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };
      }

      dispatch({
        type: 'NODE_UPDATED',
        nodeId: id,
        content,
        summary: summary ?? content.slice(0, 120),
      });
      return { content: [{ type: 'text', text: `Updated node ${id}` }] };
    },
  );

  // ---- link_nodes ----------------------------------------------------------
  server.tool(
    'link_nodes',
    'Create a cross-reference between two nodes',
    {
      from: z.string().describe('Source node ID'),
      to: z.string().describe('Target node ID'),
      relation: z.string().describe('Relation type (e.g. "see_also", "depends_on")'),
    },
    async ({ from, to, relation }) => {
      const g = graph();
      if (!g.nodes[from]) return { content: [{ type: 'text', text: `Node '${from}' not found` }], isError: true };
      if (!g.nodes[to]) return { content: [{ type: 'text', text: `Node '${to}' not found` }], isError: true };

      dispatch({ type: 'LINK_CREATED', fromId: from, link: { target: to, relation } });
      return { content: [{ type: 'text', text: `Linked ${from} → ${to} (${relation})` }] };
    },
  );

  // ---- restructure ---------------------------------------------------------
  server.tool(
    'restructure',
    'Move a node from one parent to another',
    {
      id: z.string().describe('Node to move'),
      new_parent: z.string().describe('New parent node ID'),
    },
    async ({ id, new_parent }) => {
      const g = graph();
      const node = g.nodes[id];
      if (!node) return { content: [{ type: 'text', text: `Node '${id}' not found` }], isError: true };
      if (!g.nodes[new_parent]) return { content: [{ type: 'text', text: `Node '${new_parent}' not found` }], isError: true };

      if (node.parent_ids.length === 0) {
        return { content: [{ type: 'text', text: `Node '${id}' is a root — cannot restructure` }], isError: true };
      }

      const oldParent = node.parent_ids[0]!;
      dispatch({ type: 'NODE_RESTRUCTURED', nodeId: id, oldParentId: oldParent, newParentId: new_parent });
      return { content: [{ type: 'text', text: `Moved ${id} from ${oldParent} to ${new_parent}` }] };
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

      dispatch({
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
// Neighborhood helpers
// ---------------------------------------------------------------------------

interface LeveledNode { id: string; level: number; }

function collectAncestors(g: GraphData, nodeId: string, maxDepth: number): LeveledNode[] {
  const result: LeveledNode[] = [];
  const visited = new Set<string>();

  function walk(id: string, level: number) {
    const node = g.nodes[id];
    if (!node || level > maxDepth || visited.has(id)) return;
    visited.add(id);
    for (const pid of node.parent_ids) {
      walk(pid, level + 1);
      result.push({ id: pid, level });
    }
  }

  walk(nodeId, 1);
  return result.reverse();
}

function collectDescendants(g: GraphData, nodeId: string, maxDepth: number): LeveledNode[] {
  const result: LeveledNode[] = [];
  const visited = new Set<string>();

  function walk(id: string, level: number) {
    const node = g.nodes[id];
    if (!node || level > maxDepth || visited.has(id)) return;
    visited.add(id);
    for (const cid of node.children) {
      result.push({ id: cid, level });
      walk(cid, level + 1);
    }
  }

  walk(nodeId, 1);
  return result;
}

function collectAllDescendantIds(g: GraphData, nodeId: string, acc: Set<string>): void {
  const node = g.nodes[nodeId];
  if (!node) return;
  for (const cid of node.children) {
    if (!acc.has(cid)) {
      acc.add(cid);
      collectAllDescendantIds(g, cid, acc);
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone stdio entrypoint
// ---------------------------------------------------------------------------

export async function startStdioServer(
  graph: GraphData,
  dispatchFn: (event: AppEvent) => void,
): Promise<void> {
  setGraph(graph);
  setDispatch(dispatchFn);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
