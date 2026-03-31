/**
 * Topological sort of leaf nodes into parallel epochs.
 * Topological epoch scheduler.
 */
import type { NodeData } from './types.js';

export function leafDescendants(nodes: Record<string, NodeData>, nodeId: string): Set<string> {
  const node = nodes[nodeId];
  if (!node) return new Set();
  if (node.is_leaf) return new Set([nodeId]);
  const result = new Set<string>();
  for (const childId of node.children) {
    for (const id of leafDescendants(nodes, childId)) result.add(id);
  }
  return result;
}

export function buildDepGraph(nodes: Record<string, NodeData>): Map<string, Set<string>> {
  const allLeaves = new Set(Object.keys(nodes).filter((id) => nodes[id]!.is_leaf));
  const graph = new Map<string, Set<string>>();

  for (const lid of allLeaves) {
    graph.set(lid, new Set());
    for (const depId of nodes[lid]!.dependencies) {
      if (!nodes[depId]) continue;
      for (const dl of leafDescendants(nodes, depId)) {
        if (dl !== lid) graph.get(lid)!.add(dl);
      }
    }
  }
  return graph;
}

/**
 * Returns a list of epochs. Each epoch is a list of leaf node IDs
 * that are independent and can execute in parallel.
 * Epochs must run in order.
 */
export function epochs(nodes: Record<string, NodeData>): string[][] {
  const graph = buildDepGraph(nodes);

  const inDegree = new Map<string, number>();
  for (const [lid, deps] of graph) inDegree.set(lid, deps.size);

  const dependents = new Map<string, Set<string>>();
  for (const [lid, deps] of graph) {
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(lid);
    }
  }

  const result: string[][] = [];
  let ready = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();

  while (ready.length > 0) {
    result.push(ready);
    const next: string[] = [];
    for (const lid of ready) {
      for (const dep of dependents.get(lid) ?? []) {
        inDegree.set(dep, inDegree.get(dep)! - 1);
        if (inDegree.get(dep) === 0) next.push(dep);
      }
    }
    ready = next.sort();
  }

  // cycle safety: any remaining nodes form a final epoch
  const remaining = [...inDegree.entries()]
    .filter(([, deg]) => deg > 0)
    .map(([id]) => id)
    .sort();
  if (remaining.length > 0) result.push(remaining);

  return result;
}
