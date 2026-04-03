import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setGraph, setDispatch, createMcpServer } from './mcp.js';
import type { GraphData, NodeData, Edge } from './types.js';
import type { AppEvent } from './state.js';

const now = new Date().toISOString();

function makeNode(id: string, opts: Partial<NodeData> = {}): NodeData {
  return {
    id,
    content: opts.content ?? `content of ${id}`,
    summary: opts.summary ?? `summary of ${id}`,
    exploration: opts.exploration ?? [],
    created_at: opts.created_at ?? now,
    updated_at: opts.updated_at ?? now,
  };
}

function makeEdge(id: string, a: string, b: string, label = 'related'): Edge {
  return { id, a, b, label, created_at: now };
}

let dispatched: AppEvent[];
let testGraph: GraphData;

async function makeClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.1' });
  await client.connect(clientTransport);
  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  const block = result.content[0];
  if (!block || block.type !== 'text') throw new Error('Expected text content');
  return block.text;
}

beforeEach(() => {
  dispatched = [];
  testGraph = {
    nodes: {
      root: makeNode('root', {
        content: 'Root node content about databases',
        summary: 'The root of everything',
      }),
      a: makeNode('a', {
        content: 'Node A content about storage',
        summary: 'Database layer',
      }),
      b: makeNode('b', {
        content: 'Node B content about APIs',
        summary: 'API layer',
        exploration: [{ agent: 'agent-1', timestamp: 1000, conclusion: 'needs refactoring' }],
      }),
      a1: makeNode('a1', {
        content: 'Schema definitions for databases',
        summary: 'DB schemas',
      }),
    },
    edges: {
      e1: makeEdge('e1', 'root', 'a', 'contains'),
      e2: makeEdge('e2', 'root', 'b', 'contains'),
      e3: makeEdge('e3', 'a', 'a1', 'contains'),
      e4: makeEdge('e4', 'b', 'a', 'depends_on'),
    },
  };

  setGraph(testGraph);
  setDispatch((event) => { dispatched.push(event); });
});

// ---- createMcpServer --------------------------------------------------------

describe('createMcpServer', () => {
  it('creates a server without errors', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});

describe('setGraph / setDispatch', () => {
  it('allows graph and dispatch to be wired up', () => {
    expect(dispatched).toEqual([]);
    setGraph(null);
    setGraph(testGraph);
  });
});

// ---- get_overview -----------------------------------------------------------

describe('get_overview', () => {
  it('returns node count, edge count, and all node summaries', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_overview', arguments: {} });
    const t = text(result);
    expect(t).toContain('4 nodes');
    expect(t).toContain('4 edges');
    expect(t).toContain('[root]');
    expect(t).toContain('The root of everything');
    expect(t).toContain('[a]');
    expect(t).toContain('Database layer');
  });
});

// ---- get_node ---------------------------------------------------------------

describe('get_node', () => {
  it('returns node info with edges for a known node', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_node', arguments: { id: 'a' } });
    const t = text(result);
    expect(t).toContain('[a]');
    expect(t).toContain('Database layer');
    expect(t).toContain('storage');
  });

  it('returns error for unknown node', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_node', arguments: { id: 'missing' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("'missing' not found");
  });
});

// ---- get_neighborhood -------------------------------------------------------

describe('get_neighborhood', () => {
  it('returns focal node with neighbors', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_neighborhood', arguments: { id: 'a', depth: 2 } });
    const t = text(result);
    expect(t).toContain('## Focus: [a]');
    expect(t).toContain('[root]');
    expect(t).toContain('[a1]');
    expect(t).toContain('[b]');
  });

  it('returns error for unknown node', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_neighborhood', arguments: { id: 'x', depth: 1 } });
    expect(result.isError).toBe(true);
  });
});

// ---- search -----------------------------------------------------------------

describe('search', () => {
  it('finds nodes by content keyword', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'search', arguments: { query: 'storage' } });
    expect(text(result)).toContain('[a]');
  });

  it('finds nodes by summary keyword', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'search', arguments: { query: 'schemas' } });
    expect(text(result)).toContain('[a1]');
  });

  it('returns no-results message for unmatched query', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'search', arguments: { query: 'zzznomatch' } });
    expect(text(result)).toContain('No results');
  });
});

// ---- create_node ------------------------------------------------------------

describe('create_node', () => {
  it('dispatches NODE_CREATED for a standalone node', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'create_node', arguments: { content: 'new node content' } });
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0]!;
    expect(event.type).toBe('NODE_CREATED');
    if (event.type === 'NODE_CREATED') {
      expect(event.node.content).toBe('new node content');
    }
  });

  it('dispatches NODE_CREATED + EDGE_CREATED when connect_to is given', async () => {
    const client = await makeClient();
    await client.callTool({
      name: 'create_node',
      arguments: { content: 'linked node', connect_to: 'root', edge_label: 'child_of' },
    });
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]!.type).toBe('NODE_CREATED');
    expect(dispatched[1]!.type).toBe('EDGE_CREATED');
    if (dispatched[1]!.type === 'EDGE_CREATED') {
      expect(dispatched[1]!.edge.label).toBe('child_of');
      expect(dispatched[1]!.edge.b).toBe('root');
    }
  });

  it('uses provided summary', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'create_node', arguments: { content: 'x', summary: 'my summary' } });
    const event = dispatched[0]!;
    if (event.type === 'NODE_CREATED') {
      expect(event.node.summary).toBe('my summary');
    }
  });

  it('returns error for unknown connect_to', async () => {
    const client = await makeClient();
    const result = await client.callTool({
      name: 'create_node',
      arguments: { content: 'x', connect_to: 'ghost' },
    });
    expect(result.isError).toBe(true);
    expect(dispatched).toHaveLength(0);
  });
});

// ---- update_node ------------------------------------------------------------

describe('update_node', () => {
  it('dispatches NODE_UPDATED', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'update_node', arguments: { id: 'a', content: 'new content', summary: 'new summary' } });
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0]!;
    expect(event.type).toBe('NODE_UPDATED');
    if (event.type === 'NODE_UPDATED') {
      expect(event.nodeId).toBe('a');
      expect(event.content).toBe('new content');
      expect(event.summary).toBe('new summary');
    }
  });

  it('auto-truncates content as summary when summary omitted', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'update_node', arguments: { id: 'a', content: 'short' } });
    const event = dispatched[0]!;
    if (event.type === 'NODE_UPDATED') {
      expect(event.summary).toBe('short');
    }
  });

  it('returns error for unknown node', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'update_node', arguments: { id: 'ghost', content: 'x' } });
    expect(result.isError).toBe(true);
    expect(dispatched).toHaveLength(0);
  });
});

// ---- create_edge ------------------------------------------------------------

describe('create_edge', () => {
  it('dispatches EDGE_CREATED', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'create_edge', arguments: { a: 'root', b: 'a1', label: 'see_also' } });
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0]!;
    expect(event.type).toBe('EDGE_CREATED');
    if (event.type === 'EDGE_CREATED') {
      expect(event.edge.a).toBe('root');
      expect(event.edge.b).toBe('a1');
      expect(event.edge.label).toBe('see_also');
    }
  });

  it('returns error when first node is missing', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'create_edge', arguments: { a: 'ghost', b: 'a', label: 'x' } });
    expect(result.isError).toBe(true);
  });

  it('returns error when second node is missing', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'create_edge', arguments: { a: 'a', b: 'ghost', label: 'x' } });
    expect(result.isError).toBe(true);
  });
});

// ---- delete_edge ------------------------------------------------------------

describe('delete_edge', () => {
  it('dispatches EDGE_DELETED', async () => {
    const client = await makeClient();
    await client.callTool({ name: 'delete_edge', arguments: { edge_id: 'e1' } });
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0]!;
    expect(event.type).toBe('EDGE_DELETED');
    if (event.type === 'EDGE_DELETED') {
      expect(event.edgeId).toBe('e1');
    }
  });

  it('returns error for unknown edge', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'delete_edge', arguments: { edge_id: 'ghost' } });
    expect(result.isError).toBe(true);
  });
});

// ---- record_exploration -----------------------------------------------------

describe('record_exploration', () => {
  it('dispatches EXPLORATION_UPDATED', async () => {
    const client = await makeClient();
    await client.callTool({
      name: 'record_exploration',
      arguments: { id: 'a', agent: 'agent-x', conclusion: 'looks good' },
    });
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0]!;
    expect(event.type).toBe('EXPLORATION_UPDATED');
    if (event.type === 'EXPLORATION_UPDATED') {
      expect(event.nodeId).toBe('a');
      expect(event.entry.agent).toBe('agent-x');
      expect(event.entry.conclusion).toBe('looks good');
    }
  });

  it('returns error for unknown node', async () => {
    const client = await makeClient();
    const result = await client.callTool({
      name: 'record_exploration',
      arguments: { id: 'ghost', agent: 'x' },
    });
    expect(result.isError).toBe(true);
  });
});

// ---- get_exploration_state --------------------------------------------------

describe('get_exploration_state', () => {
  it('reports nodes that have been explored', async () => {
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_exploration_state', arguments: {} });
    const t = text(result);
    expect(t).toContain('[b]');
    expect(t).toContain('agent-1');
    expect(t).toContain('needs refactoring');
  });

  it('reports no exploration when graph has none', async () => {
    setGraph({ nodes: { x: makeNode('x') }, edges: {} });
    const client = await makeClient();
    const result = await client.callTool({ name: 'get_exploration_state', arguments: {} });
    expect(text(result)).toContain('No exploration');
  });
});
