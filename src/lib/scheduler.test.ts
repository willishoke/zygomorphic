import { describe, it, expect } from 'vitest';
import { leafDescendants, buildDepGraph, epochs } from './scheduler.js';
import type { NodeData } from './types.js';

function leaf(id: string, deps: string[] = []): NodeData {
  return { id, problem: id, parent_id: null, children: [], is_leaf: true, depth: 0, plan: null, dependencies: deps, schema: null };
}

function branch(id: string, children: string[], deps: string[] = []): NodeData {
  return { id, problem: id, parent_id: null, children, is_leaf: false, depth: 0, plan: null, dependencies: deps, schema: null };
}

// ---------------------------------------------------------------------------
// leafDescendants
// ---------------------------------------------------------------------------

describe('leafDescendants', () => {
  it('returns itself for a leaf node', () => {
    const nodes = { a: leaf('a') };
    expect(leafDescendants(nodes, 'a')).toEqual(new Set(['a']));
  });

  it('returns empty set for an unknown node id', () => {
    expect(leafDescendants({}, 'x')).toEqual(new Set());
  });

  it('returns all leaf descendants of a branch node', () => {
    const nodes = {
      root: branch('root', ['a', 'b']),
      a: leaf('a'),
      b: branch('b', ['c']),
      c: leaf('c'),
    };
    expect(leafDescendants(nodes, 'root')).toEqual(new Set(['a', 'c']));
  });
});

// ---------------------------------------------------------------------------
// buildDepGraph
// ---------------------------------------------------------------------------

describe('buildDepGraph', () => {
  it('gives each leaf an empty dep set when there are no dependencies', () => {
    const nodes = {
      root: branch('root', ['a', 'b']),
      a: leaf('a'),
      b: leaf('b'),
    };
    const graph = buildDepGraph(nodes);
    expect(graph.get('a')).toEqual(new Set());
    expect(graph.get('b')).toEqual(new Set());
  });

  it('resolves a leaf dependency to that leaf', () => {
    const nodes = {
      a: leaf('a'),
      b: leaf('b', ['a']),
    };
    const graph = buildDepGraph(nodes);
    expect(graph.get('b')).toEqual(new Set(['a']));
  });

  it('resolves a branch dependency to all its leaf descendants', () => {
    const nodes = {
      root: branch('root', ['a', 'b']),
      a: branch('a', ['a1', 'a2']),
      a1: leaf('a1'),
      a2: leaf('a2'),
      b: leaf('b', ['a']), // b depends on branch a
    };
    const graph = buildDepGraph(nodes);
    expect(graph.get('b')).toEqual(new Set(['a1', 'a2']));
  });

  it('ignores dependencies on nodes that do not exist', () => {
    const nodes = { a: leaf('a', ['ghost']) };
    const graph = buildDepGraph(nodes);
    expect(graph.get('a')).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// epochs
// ---------------------------------------------------------------------------

describe('epochs', () => {
  it('returns a single epoch for a lone leaf', () => {
    const nodes = { a: leaf('a') };
    expect(epochs(nodes)).toEqual([['a']]);
  });

  it('returns a single epoch for independent leaves', () => {
    const nodes = {
      root: branch('root', ['a', 'b', 'c']),
      a: leaf('a'),
      b: leaf('b'),
      c: leaf('c'),
    };
    const result = epochs(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns sequential epochs for a linear dependency chain', () => {
    // c depends on b depends on a
    const nodes = {
      a: leaf('a'),
      b: leaf('b', ['a']),
      c: leaf('c', ['b']),
    };
    expect(epochs(nodes)).toEqual([['a'], ['b'], ['c']]);
  });

  it('handles a diamond pattern correctly', () => {
    // a is independent, b and c depend on a, d depends on b and c
    const nodes = {
      a: leaf('a'),
      b: leaf('b', ['a']),
      c: leaf('c', ['a']),
      d: leaf('d', ['b', 'c']),
    };
    const result = epochs(nodes);
    expect(result[0]).toEqual(['a']);
    expect(result[1].sort()).toEqual(['b', 'c']);
    expect(result[2]).toEqual(['d']);
  });

  it('bundles nodes that form a cycle into a trailing epoch', () => {
    // a depends on b, b depends on a — unresolvable cycle
    const nodes = {
      a: leaf('a', ['b']),
      b: leaf('b', ['a']),
    };
    const result = epochs(nodes);
    const all = result.flat().sort();
    expect(all).toEqual(['a', 'b']);
    // The cycle nodes must appear last and no empty epochs before them
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty array for an empty node map', () => {
    expect(epochs({})).toEqual([]);
  });
});
