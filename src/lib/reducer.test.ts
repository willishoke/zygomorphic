import { describe, it, expect } from 'vitest';
import { initialState, reduce, AppState } from './state.js';
import type { NodeData, Edge, GraphData, Comment } from './types.js';

// ---- Helpers ---------------------------------------------------------------

const now = new Date().toISOString();

function makeNode(id: string, opts: Partial<NodeData> = {}): NodeData {
  return {
    id,
    content: opts.content ?? id,
    summary: opts.summary ?? `summary of ${id}`,
    exploration: opts.exploration ?? [],
    created_at: opts.created_at ?? now,
    updated_at: opts.updated_at ?? now,
  };
}

function makeEdge(id: string, a: string, b: string, label = 'related'): Edge {
  return { id, a, b, label, created_at: now };
}

function makeGraph(nodes: NodeData[], edges: Edge[] = []): GraphData {
  const nodeMap: Record<string, NodeData> = {};
  for (const n of nodes) nodeMap[n.id] = n;
  const edgeMap: Record<string, Edge> = {};
  for (const e of edges) edgeMap[e.id] = e;
  return { nodes: nodeMap, edges: edgeMap };
}

function loadedState(graph?: GraphData): AppState {
  const g = graph ?? makeGraph([makeNode('root')]);
  return reduce(initialState(), { type: 'GRAPH_LOADED', graph: g });
}

// ---- GRAPH_LOADED ----------------------------------------------------------

describe('GRAPH_LOADED', () => {
  it('sets graph and transitions to browse', () => {
    const graph = makeGraph([makeNode('r')]);
    const s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    expect(s.screen.tag).toBe('browse');
    expect(s.graph).toBe(graph);
    expect(s.focusNodeId).toBe('r');
  });

  it('focuses first node', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    const s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    expect(s.focusNodeId).toBe('a');
  });

  it('handles empty graph', () => {
    const graph = makeGraph([]);
    const s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    expect(s.focusNodeId).toBeNull();
  });
});

// ---- NODE_CREATED ----------------------------------------------------------

describe('NODE_CREATED', () => {
  it('adds a node to the graph', () => {
    const s0 = loadedState();
    const node = makeNode('new');
    const s1 = reduce(s0, { type: 'NODE_CREATED', node });
    expect(s1.graph!.nodes['new']).toBe(node);
  });

  it('is a no-op without a graph', () => {
    const s0 = initialState();
    const s1 = reduce(s0, { type: 'NODE_CREATED', node: makeNode('x') });
    expect(s1).toBe(s0);
  });
});

// ---- NODE_UPDATED ----------------------------------------------------------

describe('NODE_UPDATED', () => {
  it('updates content and summary', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NODE_UPDATED', nodeId: 'root', content: 'new', summary: 'new sum' });
    expect(s1.graph!.nodes['root']!.content).toBe('new');
    expect(s1.graph!.nodes['root']!.summary).toBe('new sum');
  });

  it('is a no-op for unknown node', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NODE_UPDATED', nodeId: 'ghost', content: 'x', summary: 'x' });
    expect(s1).toBe(s0);
  });
});

// ---- NODE_DELETED ----------------------------------------------------------

describe('NODE_DELETED', () => {
  it('removes node and its edges', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b')],
      [makeEdge('e1', 'a', 'b')],
    );
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'b' });
    expect(s1.graph!.nodes['b']).toBeUndefined();
    expect(s1.graph!.edges['e1']).toBeUndefined();
  });

  it('clears focus if deleted node was focused', () => {
    const s0 = loadedState();
    expect(s0.focusNodeId).toBe('root');
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'root' });
    expect(s1.focusNodeId).toBeNull();
  });

  it('removes from navigation history', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    let s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    s = reduce(s, { type: 'NAVIGATION_PUSH', nodeId: 'a' });
    s = reduce(s, { type: 'NAVIGATION_PUSH', nodeId: 'b' });
    s = reduce(s, { type: 'NODE_DELETED', nodeId: 'b' });
    expect(s.navigationHistory).not.toContain('b');
  });

  it('is a no-op for unknown node', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'ghost' });
    expect(s1).toBe(s0);
  });
});

// ---- EDGE_CREATED / EDGE_DELETED -------------------------------------------

describe('EDGE_CREATED', () => {
  it('adds an edge', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    const s0 = loadedState(graph);
    const edge = makeEdge('e1', 'a', 'b', 'knows');
    const s1 = reduce(s0, { type: 'EDGE_CREATED', edge });
    expect(s1.graph!.edges['e1']).toBe(edge);
  });
});

describe('EDGE_DELETED', () => {
  it('removes an edge', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b')],
      [makeEdge('e1', 'a', 'b')],
    );
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'EDGE_DELETED', edgeId: 'e1' });
    expect(s1.graph!.edges['e1']).toBeUndefined();
  });
});

// ---- COMMENTS_LOADED / COMMENT_ADDED ---------------------------------------

describe('COMMENTS_LOADED', () => {
  it('replaces focal comments', () => {
    const s0 = loadedState();
    const comments: Comment[] = [
      { id: 'c1', node_id: 'root', content: 'hi', author: 'human', created_at: now, expires_at: null, score: 0, deleted_at: null },
    ];
    const s1 = reduce(s0, { type: 'COMMENTS_LOADED', comments });
    expect(s1.focalComments).toEqual(comments);
  });
});

describe('COMMENT_ADDED', () => {
  it('appends a comment', () => {
    const s0 = loadedState();
    const c1: Comment = { id: 'c1', node_id: 'root', content: 'first', author: 'human', created_at: now, expires_at: null, score: 0, deleted_at: null };
    const s1 = reduce(s0, { type: 'COMMENT_ADDED', comment: c1 });
    expect(s1.focalComments).toHaveLength(1);

    const c2: Comment = { id: 'c2', node_id: 'root', content: 'second', author: 'agent', created_at: now, expires_at: null, score: 0, deleted_at: null };
    const s2 = reduce(s1, { type: 'COMMENT_ADDED', comment: c2 });
    expect(s2.focalComments).toHaveLength(2);
  });
});

// ---- EXPLORATION_UPDATED ---------------------------------------------------

describe('EXPLORATION_UPDATED', () => {
  it('appends an exploration entry', () => {
    const s0 = loadedState();
    const entry = { agent: 'agent-1', timestamp: 1000, conclusion: 'relevant' };
    const s1 = reduce(s0, { type: 'EXPLORATION_UPDATED', nodeId: 'root', entry });
    expect(s1.graph!.nodes['root']!.exploration).toEqual([entry]);
  });
});

// ---- NAVIGATION_PUSH / NAVIGATION_BACK ------------------------------------

describe('NAVIGATION_PUSH', () => {
  it('pushes to history and sets focus', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'NAVIGATION_PUSH', nodeId: 'b' });
    expect(s1.focusNodeId).toBe('b');
    expect(s1.navigationHistory).toEqual(['b']);
  });
});

describe('NAVIGATION_BACK', () => {
  it('pops history and restores focus', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    let s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    s = reduce(s, { type: 'NAVIGATION_PUSH', nodeId: 'a' });
    s = reduce(s, { type: 'NAVIGATION_PUSH', nodeId: 'b' });
    expect(s.focusNodeId).toBe('b');

    s = reduce(s, { type: 'NAVIGATION_BACK' });
    expect(s.focusNodeId).toBe('a');
    expect(s.navigationHistory).toEqual(['a']);
  });

  it('is a no-op with one or zero history entries', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NAVIGATION_BACK' });
    expect(s1).toBe(s0);
  });
});

// ---- FOCUS_CHANGED ---------------------------------------------------------

describe('FOCUS_CHANGED', () => {
  it('updates focusNodeId', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')]);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'FOCUS_CHANGED', nodeId: 'b' });
    expect(s1.focusNodeId).toBe('b');
  });

  it('can clear focus to null', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'FOCUS_CHANGED', nodeId: null });
    expect(s1.focusNodeId).toBeNull();
  });
});

// ---- ERROR -----------------------------------------------------------------

describe('ERROR', () => {
  it('clears loading and sets the message', () => {
    const s0: AppState = { ...loadedState(), loading: true };
    const s1 = reduce(s0, { type: 'ERROR', message: 'something broke' });
    expect(s1.loading).toBe(false);
    expect(s1.error).toBe('something broke');
  });
});
