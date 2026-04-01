import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => {
  dispatched = [];
  testGraph = {
    nodes: {
      root: makeNode('root', {
        content: 'Root node content',
        summary: 'The root of everything',
      }),
      a: makeNode('a', {
        content: 'Node A content about databases',
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
