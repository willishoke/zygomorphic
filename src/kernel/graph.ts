/**
 * graph.ts — Dependency graph algorithms.
 *
 * Pure graph operations with no coupling to the categorical type system.
 * Migrated verbatim from tropical's compiler.ts (topologicalSort, tarjanSCC).
 */

// --- Topological sort (Kahn's algorithm with level grouping) ---

export interface TopologicalResult {
  /** Nodes in topological execution order. */
  order: string[];
  /** Nodes grouped by parallel execution level. */
  levels: string[][];
  /** True if all nodes were sorted (false means cycles exist). */
  complete: boolean;
}

/**
 * Topological sort with level grouping.
 *
 * Nodes at the same level have no dependency between them and can
 * execute concurrently. Levels are ordered: every node in level N+1
 * depends on at least one node in level <= N.
 */
export function topologicalSort(
  deps: Map<string, Set<string>>,
): TopologicalResult {
  const inDegree = new Map<string, number>();
  const consumers = new Map<string, Set<string>>();

  for (const name of deps.keys()) {
    inDegree.set(name, 0);
    consumers.set(name, new Set());
  }
  for (const [consumer, producers] of deps) {
    inDegree.set(consumer, producers.size);
    for (const producer of producers) {
      consumers.get(producer)?.add(consumer);
    }
  }

  const order: string[] = [];
  const levels: string[][] = [];
  let queue = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([n]) => n)
    .sort();

  while (queue.length > 0) {
    levels.push([...queue]);
    order.push(...queue);
    const next: string[] = [];
    for (const node of queue) {
      for (const c of consumers.get(node) ?? []) {
        const d = inDegree.get(c)! - 1;
        inDegree.set(c, d);
        if (d === 0) next.push(c);
      }
    }
    queue = next.sort();
  }

  return { order, levels, complete: order.length === deps.size };
}

// --- Tarjan's SCC — cycle detection ---

/**
 * Find strongly connected components using Tarjan's algorithm.
 * Cycles are SCCs with more than one member.
 */
export function tarjanSCC(deps: Map<string, Set<string>>): string[][] {
  let idx = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function visit(v: string): void {
    indices.set(v, idx);
    lowlinks.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);

    for (const w of deps.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of deps.keys()) {
    if (!indices.has(v)) visit(v);
  }

  return sccs;
}
