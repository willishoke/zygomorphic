/**
 * signal-executor.ts — Signal/slot execution engine.
 *
 * Signal/slot is the natural operational semantics of the categorical model.
 * A morphism fires when all its input slots are filled. Each output wire
 * is a signal; each input wire is a slot. No global barrier, no epochs —
 * maximal async parallelism.
 *
 * Execution modes by term constructor:
 *   morphism:  fire body, validate output against codomain
 *   compose:   wire first's output signal to second's input slot
 *   tensor:    fire both branches concurrently (causal independence)
 *   trace:     loop body until left injection exits (conditional retry)
 *   id:        pass input through as output
 *
 * Design principle: no component has global graph visibility. The dependency
 * structure is encoded in the wiring. Locality is load-bearing.
 */

import type { ArtifactType, MorphismBody, Term } from './types.js';
import { productType, sumType } from './types.js';
import { inferType, typesEqual } from './type-check.js';
import { validate } from './validate.js';

// --- Runtime value types ---

export interface Artifact {
  type: ArtifactType;
  value: unknown;
}

/**
 * Runtime representation of a sum-type value (B + S).
 * Left injection exits the trace; right injection feeds back.
 */
export interface SumValue {
  tag: 'left' | 'right';
  value: unknown;
}

export function isSumValue(v: unknown): v is SumValue {
  return typeof v === 'object' && v !== null && 'tag' in v
    && ((v as SumValue).tag === 'left' || (v as SumValue).tag === 'right');
}

// --- Executor interface ---

/**
 * Execute a morphism body given an input artifact. Returns the raw output.
 * For trace bodies, must return a SumValue indicating exit or retry.
 */
export type BodyExecutor = (body: MorphismBody, input: Artifact) => Promise<unknown>;

export interface ExecutionOptions {
  /** Maximum trace iterations before aborting. Default: 100. */
  maxTraceIterations?: number;
}

// --- Signal/slot executor ---

/**
 * Execute a term against an input artifact using the signal/slot model.
 *
 * Handles all term constructors:
 * - morphism: fire body, validate output
 * - compose: sequential signal propagation
 * - tensor: concurrent parallel execution
 * - trace: conditional retry loop
 * - id: pass-through
 */
export async function signalExecute(
  term: Term,
  input: Artifact,
  bodyExecutor: BodyExecutor,
  options: ExecutionOptions = {},
): Promise<Artifact> {
  const maxIter = options.maxTraceIterations ?? 100;

  async function exec(t: Term, inp: Artifact): Promise<Artifact> {
    switch (t.tag) {
      case 'id':
        return inp;

      case 'morphism': {
        const rawOutput = await bodyExecutor(t.body, inp);
        await validateOutput(t.name, t.cod, rawOutput);
        return { type: t.cod, value: rawOutput };
      }

      case 'compose': {
        const mid = await exec(t.first, inp);
        return exec(t.second, mid);
      }

      case 'tensor': {
        // Split input into left and right components
        const leftType = inferType(t.left);
        const rightType = inferType(t.right);
        const { left: leftValue, right: rightValue } = splitProductValue(inp, leftType.dom, rightType.dom);

        const leftInput: Artifact = { type: leftType.dom, value: leftValue };
        const rightInput: Artifact = { type: rightType.dom, value: rightValue };

        // Fire both branches concurrently — causal independence
        const [leftOutput, rightOutput] = await Promise.all([
          exec(t.left, leftInput),
          exec(t.right, rightInput),
        ]);

        // Combine outputs into product
        return {
          type: productType([leftOutput.type, rightOutput.type]),
          value: [leftOutput.value, rightOutput.value],
        };
      }

      case 'trace': {
        // body: A⊗S → B+S
        // Input to trace is A. State starts at init.
        // Each iteration: body receives [A_value, state], returns SumValue.
        // Left(B) exits. Right(S') retries with new state.
        const bodyType = inferType(t.body);
        let state: unknown = t.init;

        for (let i = 0; i < maxIter; i++) {
          // Build body input: A ⊗ S
          const bodyInput: Artifact = {
            type: bodyType.dom,
            value: [inp.value, state],
          };

          const bodyOutput = await exec(t.body, bodyInput);

          // Body output must be a SumValue
          if (!isSumValue(bodyOutput.value)) {
            throw new ExecutionError(
              `Trace body must return a SumValue { tag: 'left'|'right', value }, `
              + `got: ${typeof bodyOutput.value}`,
            );
          }

          const sum = bodyOutput.value;

          if (sum.tag === 'left') {
            // Exit: left injection is the output type B
            const exitType = inferType({ tag: 'trace', stateType: t.stateType, init: t.init, body: t.body });
            return { type: exitType.cod, value: sum.value };
          }

          // Retry: right injection is the new state S'
          state = sum.value;
        }

        throw new ExecutionError(
          `Trace did not converge after ${maxIter} iterations`,
        );
      }
    }
  }

  return exec(term, input);
}

// --- Helpers ---

export class ExecutionError extends Error {
  override name = 'ExecutionError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Validate a morphism's raw output against its codomain type.
 *
 * Handles structural types specially:
 * - Sum codomain: output must be SumValue. Left (exit) branch is validated.
 *   Right (retry/feedback) branch is NOT validated — it's internal state
 *   that re-enters the trace loop. The output guarantee comes from exit.
 * - Product codomain: output must be array. Each component validated
 *   against its corresponding validator.
 * - Scalar codomain: direct validation.
 */
async function validateOutput(
  morphismName: string,
  codomain: ArtifactType,
  rawOutput: unknown,
): Promise<void> {
  // Sum-type codomain: body returns SumValue
  if (codomain.validator.kind === 'sum') {
    if (!isSumValue(rawOutput)) {
      throw new ExecutionError(
        `Morphism "${morphismName}" has sum codomain but body did not return `
        + `a SumValue { tag: 'left'|'right', value }`,
      );
    }
    // Only validate the exit path (left). The retry path (right) is
    // internal feedback state — its validity is ensured when the trace
    // eventually exits via left injection.
    if (rawOutput.tag === 'left') {
      const result = await validate(codomain.validator.left, rawOutput.value);
      if (!result.passed) {
        throw new ExecutionError(
          `Validation failed for morphism "${morphismName}" (exit): `
          + `${result.errors?.join(', ')}`,
        );
      }
    }
    return;
  }

  // Product-type codomain: validate each component
  if (codomain.validator.kind === 'tensor' && codomain.validator.checks.length > 0) {
    if (Array.isArray(rawOutput) && rawOutput.length === codomain.validator.checks.length) {
      for (let i = 0; i < rawOutput.length; i++) {
        const result = await validate(codomain.validator.checks[i], rawOutput[i]);
        if (!result.passed) {
          throw new ExecutionError(
            `Validation failed for morphism "${morphismName}" (component ${i}): `
            + `${result.errors?.join(', ')}`,
          );
        }
      }
      return;
    }
    // Fall through to scalar validation if not an array
  }

  // Scalar codomain: direct validation
  const result = await validate(codomain.validator, rawOutput);
  if (!result.passed) {
    throw new ExecutionError(
      `Validation failed for morphism "${morphismName}": ${result.errors?.join(', ')}`,
    );
  }
}

/**
 * Split a product artifact value into left and right components.
 *
 * Product values are represented as arrays: [leftValue, rightValue].
 * If the input type matches one side exactly (no product), the value
 * is used directly for that side.
 */
function splitProductValue(
  artifact: Artifact,
  leftType: ArtifactType,
  rightType: ArtifactType,
): { left: unknown; right: unknown } {
  // If either side is Unit, the product collapses
  const leftIsUnit = leftType.validator.kind === 'tensor'
    && (leftType.validator.checks as []).length === 0;
  const rightIsUnit = rightType.validator.kind === 'tensor'
    && (rightType.validator.checks as []).length === 0;

  if (leftIsUnit && rightIsUnit) {
    return { left: null, right: null };
  }
  if (leftIsUnit) {
    return { left: null, right: artifact.value };
  }
  if (rightIsUnit) {
    return { left: artifact.value, right: null };
  }

  // Full product: value must be [left, right]
  if (!Array.isArray(artifact.value) || artifact.value.length !== 2) {
    throw new ExecutionError(
      `Expected product value [left, right] for type "${artifact.type.name}", `
      + `got: ${JSON.stringify(artifact.value)}`,
    );
  }

  return { left: artifact.value[0], right: artifact.value[1] };
}
