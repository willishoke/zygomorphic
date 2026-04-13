import type { ArtifactType, MorphismBody, Term } from './types.js';
import { productType, isSumValue } from './types.js';
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

/**
 * Execute any term recursively.
 *
 * Handles id, morphism, compose, and trace (conditional feedback loop).
 * Tensor still delegates to the signal/slot executor.
 *
 * Trace semantics: body runs with A⊗S input and produces a SumValue.
 *   left(b)  → exit the loop, return b as the output
 *   right(s) → update state to s, iterate
 */
export async function executeTerm(
  term: Term,
  input: Artifact,
  bodyExecutor: BodyExecutor,
  maxIterations = 100,
): Promise<Artifact> {
  switch (term.tag) {
    case 'id':
      return input;

    case 'morphism': {
      const rawOutput = await bodyExecutor(term.body, input);
      const result = await validate(term.cod.validator, rawOutput);
      if (!result.passed) {
        throw new Error(
          `Validation failed for morphism "${term.name}": ${result.errors?.join(', ')}`,
        );
      }
      return { type: term.cod, value: rawOutput };
    }

    case 'compose': {
      const mid = await executeTerm(term.first, input, bodyExecutor, maxIterations);
      return executeTerm(term.second, mid, bodyExecutor, maxIterations);
    }

    case 'tensor':
      throw new Error('Tensor execution requires signal/slot executor (not yet implemented)');

    case 'trace': {
      const traceType = inferType(term);  // { dom: A, cod: B }
      let state: unknown = term.init;

      for (let i = 0; i < maxIterations; i++) {
        const productInput: Artifact = {
          type: productType([input.type, term.stateType]),
          value: [input.value, state],
        };

        const bodyOutput = await executeTerm(term.body, productInput, bodyExecutor, maxIterations);

        if (!isSumValue(bodyOutput.value)) {
          throw new Error(
            `Trace body must produce a SumValue (left/right injection), got: `
            + JSON.stringify(bodyOutput.value),
          );
        }

        if (bodyOutput.value.tag === 'left') {
          return { type: traceType.cod, value: bodyOutput.value.value };
        }

        state = bodyOutput.value.value;
      }

      throw new Error(`Trace did not converge after ${maxIterations} iterations`);
    }
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
