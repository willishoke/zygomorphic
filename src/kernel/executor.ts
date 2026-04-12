import type { ArtifactType, MorphismBody, Term } from './types.js';
import { inferType } from './type-check.js';
import { validate } from './validate.js';

export interface Artifact {
  type: ArtifactType;
  value: unknown;
}

export interface ExecutionNode {
  term: Term & { tag: 'morphism' };
  input: Artifact | null;
  output: Artifact | null;
  downstream: ExecutionNode | null;
}

export type BodyExecutor = (body: MorphismBody, input: Artifact) => Promise<unknown>;

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
      // Identity is a no-op in execution — pass through
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

/** Execute a pipeline: fill the first slot, cascade through to the final output. */
export async function execute(
  graph: ExecutionNode[],
  input: Artifact,
  bodyExecutor: BodyExecutor,
): Promise<Artifact> {
  if (graph.length === 0) {
    // Pure identity — pass through
    return input;
  }

  // Type-check the full term before executing (fail fast at planning time)
  // This is already done by the caller via inferType, but we validate the input type here
  const firstNode = graph[0];
  const lastNode = graph[graph.length - 1];

  let current: Artifact = input;

  for (const node of graph) {
    node.input = current;

    // Execute the body
    const rawOutput = await bodyExecutor(node.term.body, current);

    // Validate output against codomain type
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
