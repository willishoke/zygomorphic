import type { Term } from './types.js';
import type { Artifact, BodyExecutor } from './types.js';
export type { Artifact, BodyExecutor } from './types.js';
import { validate } from './validate.js';

export interface ExecutionNode {
  term: Term & { tag: 'morphism' };
  input: Artifact | null;
  output: Artifact | null;
  downstream: ExecutionNode | null;
}

/** Flatten a composed term into a linear sequence of morphism nodes, wired in order. */
export function buildGraph(term: Term): ExecutionNode[] {
  const nodes: ExecutionNode[] = [];
  flatten(term, nodes);

  // Wire each node's downstream to the next
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].downstream = nodes[i + 1];
  }

  return nodes;
}

function flatten(term: Term, out: ExecutionNode[]): void {
  switch (term.tag) {
    case 'id':
      return;
    case 'morphism':
      out.push({ term, input: null, output: null, downstream: null });
      return;
    case 'compose':
      flatten(term.first, out);
      flatten(term.second, out);
      return;
    case 'tensor':
      throw new Error('Tensor execution requires signal/slot executor (not yet implemented)');
    case 'trace':
      throw new Error('Trace execution requires signal/slot executor (not yet implemented)');
  }
}

/** Execute a linear pipeline produced by buildGraph. */
export async function execute(
  graph: ExecutionNode[],
  input: Artifact,
  bodyExecutor: BodyExecutor,
): Promise<Artifact> {
  if (graph.length === 0) return input;

  let current: Artifact = input;

  for (const node of graph) {
    node.input = current;

    const rawOutput = await bodyExecutor(node.term.body, current);

    const result = await validate(node.term.cod.validator, rawOutput);
    if (!result.passed) {
      throw new Error(
        `Validation failed for morphism "${node.term.name}": ${result.errors?.join(', ')}`
      );
    }

    current = { type: node.term.cod, value: rawOutput };
    node.output = current;
  }

  return current;
}
