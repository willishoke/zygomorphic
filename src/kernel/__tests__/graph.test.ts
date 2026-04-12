import { describe, it, expect } from 'vitest';
import { topologicalSort, tarjanSCC } from '../graph.js';

function deps(edges: Record<string, string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [k, vs] of Object.entries(edges)) {
    m.set(k, new Set(vs));
  }
  return m;
}

describe('topologicalSort', () => {
  it('sorts a linear chain', () => {
    const d = deps({ a: [], b: ['a'], c: ['b'] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(true);
    expect(result.order).toEqual(['a', 'b', 'c']);
    expect(result.levels).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups independent nodes into the same level', () => {
    //  a
    //  |
    // b  c   (b and c are independent, both depend on a)
    //  |
    //  d     (depends on b)
    const d = deps({ a: [], b: ['a'], c: ['a'], d: ['b'] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(true);
    expect(result.levels[0]).toEqual(['a']);
    expect(result.levels[1]).toEqual(expect.arrayContaining(['b', 'c']));
    expect(result.levels[1]).toHaveLength(2);
  });

  it('handles diamond dependency', () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const d = deps({ a: [], b: ['a'], c: ['a'], d: ['b', 'c'] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(true);
    expect(result.levels).toHaveLength(3);
    expect(result.levels[0]).toEqual(['a']);
    expect(result.levels[2]).toEqual(['d']);
  });

  it('detects cycle (incomplete sort)', () => {
    const d = deps({ a: ['b'], b: ['a'] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(false);
    expect(result.order).toHaveLength(0);
  });

  it('handles empty graph', () => {
    const result = topologicalSort(new Map());
    expect(result.complete).toBe(true);
    expect(result.order).toEqual([]);
    expect(result.levels).toEqual([]);
  });

  it('handles single node', () => {
    const d = deps({ a: [] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(true);
    expect(result.order).toEqual(['a']);
    expect(result.levels).toEqual([['a']]);
  });

  it('handles disconnected components', () => {
    const d = deps({ a: [], b: [], c: ['a'] });
    const result = topologicalSort(d);
    expect(result.complete).toBe(true);
    expect(result.levels[0]).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('tarjanSCC', () => {
  it('finds no cycles in a DAG', () => {
    const d = deps({ a: [], b: ['a'], c: ['b'] });
    const sccs = tarjanSCC(d);
    // Every SCC should be a singleton
    for (const scc of sccs) {
      expect(scc).toHaveLength(1);
    }
  });

  it('finds a simple 2-node cycle', () => {
    const d = deps({ a: ['b'], b: ['a'] });
    const sccs = tarjanSCC(d);
    const cycles = sccs.filter(s => s.length > 1);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('finds a 3-node cycle', () => {
    const d = deps({ a: ['b'], b: ['c'], c: ['a'] });
    const sccs = tarjanSCC(d);
    const cycles = sccs.filter(s => s.length > 1);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('separates independent cycles', () => {
    const d = deps({ a: ['b'], b: ['a'], c: ['d'], d: ['c'] });
    const sccs = tarjanSCC(d);
    const cycles = sccs.filter(s => s.length > 1);
    expect(cycles).toHaveLength(2);
  });

  it('handles empty graph', () => {
    const sccs = tarjanSCC(new Map());
    expect(sccs).toEqual([]);
  });

  it('mixed DAG and cycle', () => {
    // a -> b <-> c, d -> b
    const d = deps({ a: [], b: ['a', 'c'], c: ['b'], d: [] });
    const sccs = tarjanSCC(d);
    const cycles = sccs.filter(s => s.length > 1);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(['b', 'c']));
  });
});
