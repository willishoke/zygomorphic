import { describe, it, expect } from 'vitest';
import { initialState, reduce, AppState, AppEvent } from './state.js';
import type { NodeData, GraphData } from './types.js';

// ---- Helpers ---------------------------------------------------------------

function makeNode(id: string, opts: Partial<NodeData> = {}): NodeData {
  return {
    id,
    content: opts.content ?? id,
    summary: opts.summary ?? `summary of ${id}`,
    parent_ids: opts.parent_ids ?? [],
    children: opts.children ?? [],
    links: opts.links ?? [],
    depth: opts.depth ?? 0,
    exploration: opts.exploration ?? [],
  };
}

function makeGraph(nodes: NodeData[], root_ids?: string[]): GraphData {
  const nodeMap: Record<string, NodeData> = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return {
    root_ids: root_ids ?? nodes.filter((n) => n.parent_ids.length === 0).map((n) => n.id),
    nodes: nodeMap,
  };
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

  it('focuses first root when multiple roots exist', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], ['a', 'b']);
    const s = reduce(initialState(), { type: 'GRAPH_LOADED', graph });
    expect(s.focusNodeId).toBe('a');
  });
});

// ---- NODE_CREATED ----------------------------------------------------------

describe('NODE_CREATED', () => {
  it('adds a root node when no parents', () => {
    const s0 = loadedState();
    const node = makeNode('new');
    const s1 = reduce(s0, { type: 'NODE_CREATED', node });
    expect(s1.graph!.nodes['new']).toBe(node);
    expect(s1.graph!.root_ids).toContain('new');
  });

  it('adds a child node and updates parent', () => {
    const s0 = loadedState();
    const child = makeNode('child', { parent_ids: ['root'] });
    const s1 = reduce(s0, { type: 'NODE_CREATED', node: child });
    expect(s1.graph!.nodes['child']).toBe(child);
    expect(s1.graph!.nodes['root']!.children).toContain('child');
    expect(s1.graph!.root_ids).not.toContain('child');
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
    const s1 = reduce(s0, { type: 'NODE_UPDATED', nodeId: 'root', content: 'new content', summary: 'new summary' });
    expect(s1.graph!.nodes['root']!.content).toBe('new content');
    expect(s1.graph!.nodes['root']!.summary).toBe('new summary');
  });

  it('is a no-op for unknown node', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NODE_UPDATED', nodeId: 'ghost', content: 'x', summary: 'x' });
    expect(s1).toBe(s0);
  });
});

// ---- NODE_DELETED ----------------------------------------------------------

describe('NODE_DELETED', () => {
  it('removes node and cleans up parent references', () => {
    const parent = makeNode('p', { children: ['c'] });
    const child = makeNode('c', { parent_ids: ['p'] });
    const graph = makeGraph([parent, child], ['p']);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'c' });
    expect(s1.graph!.nodes['c']).toBeUndefined();
    expect(s1.graph!.nodes['p']!.children).toEqual([]);
  });

  it('removes from root_ids if root', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], ['a', 'b']);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'a' });
    expect(s1.graph!.root_ids).toEqual(['b']);
  });

  it('clears focus if deleted node was focused', () => {
    const s0 = loadedState();
    expect(s0.focusNodeId).toBe('root');
    const s1 = reduce(s0, { type: 'NODE_DELETED', nodeId: 'root' });
    expect(s1.focusNodeId).toBeNull();
  });
});

// ---- LINK_CREATED / LINK_DELETED -------------------------------------------

describe('LINK_CREATED', () => {
  it('adds a link to the source node', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], ['a', 'b']);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'LINK_CREATED', fromId: 'a', link: { target: 'b', relation: 'see_also' } });
    expect(s1.graph!.nodes['a']!.links).toEqual([{ target: 'b', relation: 'see_also' }]);
  });
});

describe('LINK_DELETED', () => {
  it('removes the matching link', () => {
    const a = makeNode('a', { links: [{ target: 'b', relation: 'see_also' }, { target: 'c', relation: 'depends_on' }] });
    const graph = makeGraph([a, makeNode('b'), makeNode('c')], ['a', 'b', 'c']);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'LINK_DELETED', fromId: 'a', targetId: 'b', relation: 'see_also' });
    expect(s1.graph!.nodes['a']!.links).toEqual([{ target: 'c', relation: 'depends_on' }]);
  });
});

// ---- NODE_RESTRUCTURED -----------------------------------------------------

describe('NODE_RESTRUCTURED', () => {
  it('moves node from old parent to new parent', () => {
    const p1 = makeNode('p1', { children: ['child'] });
    const p2 = makeNode('p2');
    const child = makeNode('child', { parent_ids: ['p1'] });
    const graph = makeGraph([p1, p2, child], ['p1', 'p2']);
    const s0 = loadedState(graph);
    const s1 = reduce(s0, { type: 'NODE_RESTRUCTURED', nodeId: 'child', oldParentId: 'p1', newParentId: 'p2' });

    expect(s1.graph!.nodes['child']!.parent_ids).toEqual(['p2']);
    expect(s1.graph!.nodes['p1']!.children).toEqual([]);
    expect(s1.graph!.nodes['p2']!.children).toEqual(['child']);
  });

  it('is a no-op when nodes do not exist', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'NODE_RESTRUCTURED', nodeId: 'ghost', oldParentId: 'root', newParentId: 'root' });
    expect(s1).toBe(s0);
  });
});

// ---- SUMMARY_UPDATED -------------------------------------------------------

describe('SUMMARY_UPDATED', () => {
  it('updates the summary on the target node', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'SUMMARY_UPDATED', nodeId: 'root', summary: 'updated summary' });
    expect(s1.graph!.nodes['root']!.summary).toBe('updated summary');
  });
});

// ---- EXPLORATION_UPDATED ---------------------------------------------------

describe('EXPLORATION_UPDATED', () => {
  it('appends an exploration entry', () => {
    const s0 = loadedState();
    const entry = { agent: 'agent-1', timestamp: 1000, conclusion: 'relevant' };
    const s1 = reduce(s0, { type: 'EXPLORATION_UPDATED', nodeId: 'root', entry });
    expect(s1.graph!.nodes['root']!.exploration).toEqual([entry]);

    const entry2 = { agent: 'agent-2', timestamp: 2000 };
    const s2 = reduce(s1, { type: 'EXPLORATION_UPDATED', nodeId: 'root', entry: entry2 });
    expect(s2.graph!.nodes['root']!.exploration).toEqual([entry, entry2]);
  });
});

// ---- FOCUS_CHANGED ---------------------------------------------------------

describe('FOCUS_CHANGED', () => {
  it('updates focusNodeId', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], ['a', 'b']);
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

  it('preserves the current screen', () => {
    const s0 = loadedState();
    const s1 = reduce(s0, { type: 'ERROR', message: 'nope' });
    expect(s1.screen.tag).toBe('browse');
  });
});
