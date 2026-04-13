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

import type { ArtifactType, Term, Artifact, BodyExecutor, SumValue } from './types.js';
import { productType, isSumValue } from './types.js';
import { inferType, typesEqual } from './type-check.js';
import { validate } from './validate.js';
import { escalate } from './autonomy.js';

// Re-export consolidated runtime types so callers don't need a second import.
export type { Artifact, BodyExecutor, SumValue } from './types.js';
export { isSumValue } from './types.js';

export interface ExecutionOptions {
  /** Maximum trace iterations before aborting. Default: 100. */
  maxTraceIterations?: number;
  /**
   * Iteration count at which an auto-autonomy trace escalates.
   * Escalation throws EscalationError so the caller can route to human review.
   * Default: half of maxTraceIterations.
   */
  escalationThreshold?: number;
  /**
   * Live factoring table. When a morphism has an active forwarding pointer,
   * its execution is redirected to the replacement term. Append-only and
   * lock-free: in-flight morphisms complete normally; only future invocations
   * of the factored name see the new routing.
   */
  liveFactoring?: LiveFactoringTable;
}

// --- Live factoring ---

/**
 * A runtime forwarding table for mid-execution factoring.
 *
 * Maps morphism names to replacement terms. Before firing a morphism,
 * the executor checks this table. If a pointer exists, the replacement
 * term is executed in place of the original body.
 *
 * Type boundaries are validated at factor() time, not execution time,
 * so redirected execution always preserves the morphism's typed interface.
 *
 * Rewind is localized: rewind(name) removes the pointer; subsequent
 * invocations revert to the original body.
 */
export class LiveFactoringTable {
  private readonly table = new Map<string, Term>();

  /**
   * Register a forwarding pointer for morphismName.
   * replacement must have the same domain and codomain as declared in boundary.
   */
  factor(
    morphismName: string,
    replacement: Term,
    boundary: { dom: ArtifactType; cod: ArtifactType },
  ): void {
    const replType = inferType(replacement);
    if (!typesEqual(replType.dom, boundary.dom)) {
      throw new FactoringError(
        `Live factoring of "${morphismName}": replacement domain "${replType.dom.name}" `
        + `does not match expected "${boundary.dom.name}"`,
      );
    }
    if (!typesEqual(replType.cod, boundary.cod)) {
      throw new FactoringError(
        `Live factoring of "${morphismName}": replacement codomain "${replType.cod.name}" `
        + `does not match expected "${boundary.cod.name}"`,
      );
    }
    this.table.set(morphismName, replacement);
  }

  /** Remove the forwarding pointer. Subsequent invocations use the original body. */
  rewind(morphismName: string): void {
    this.table.delete(morphismName);
  }

  /** Return the replacement term if one is registered, else undefined. */
  get(morphismName: string): Term | undefined {
    return this.table.get(morphismName);
  }

  /** Whether a forwarding pointer is active for this name. */
  isActive(morphismName: string): boolean {
    return this.table.has(morphismName);
  }

  /** Number of active forwarding pointers. */
  get size(): number {
    return this.table.size;
  }
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
        // Forwarding pointer: if this morphism has been factored at runtime,
        // redirect to the replacement term. In-flight invocations (already
        // past this check) complete normally — only future calls are redirected.
        const forwarded = options.liveFactoring?.get(t.name);
        if (forwarded) {
          return exec(forwarded, inp);
        }
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
        const exitType = inferType(t);
        const threshold = options.escalationThreshold ?? Math.ceil(maxIter / 2);
        let state: unknown = t.init;
        // Autonomy starts at auto; escalation may promote it to approve.
        let autonomy = 'auto' as import('./types.js').Autonomy;

        for (let i = 0; i < maxIter; i++) {
          // Escalation check: auto traces that aren't converging promote to approve.
          autonomy = escalate(autonomy, i, threshold);
          if (autonomy !== 'auto') {
            throw new EscalationError(
              `Trace did not converge after ${i} iterations — escalating to human review`,
              i,
              state,
            );
          }

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

export class FactoringError extends Error {
  override name = 'FactoringError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a trace escalates from auto to approve.
 * Carries enough context for the caller to route to human review.
 */
export class EscalationError extends Error {
  override name = 'EscalationError';
  readonly iterations: number;
  readonly currentState: unknown;
  constructor(message: string, iterations: number, currentState: unknown) {
    super(message);
    this.iterations = iterations;
    this.currentState = currentState;
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
