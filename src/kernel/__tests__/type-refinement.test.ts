/**
 * type-refinement.test.ts — Verify the type refinement ratchet is emergent.
 *
 * Type refinement is not a separate component. It emerges from:
 *   - Conditional trace (retry feeds back error context)
 *   - The 'none' validator (forces factoring)
 *   - 2-cell structure (factoring introduces intermediate types)
 *   - Validator-as-type (tighter validator = tighter type)
 *
 * These tests demonstrate the ratchet behavior: types start weak,
 * get refined through failure, type bloat signals wrong factoring.
 */

import { describe, it, expect } from 'vitest';
import { morphism, compose, trace, productType, sumType } from '../types.js';
import { inferType, typesEqual } from '../type-check.js';
import { factor, checkRewrite } from '../rewrite.js';
import { signalExecute } from '../signal-executor.js';
import type { SumValue, Artifact, BodyExecutor } from '../signal-executor.js';
import { validate } from '../validate.js';
import type { ArtifactType, ValidatorSpec } from '../types.js';

const body = { kind: 'agent' as const, prompt: '' };

describe('type refinement ratchet', () => {
  it('none validator forces factoring — cannot execute', async () => {
    // A morphism with 'none' codomain validator cannot execute
    const result = await validate({ kind: 'none' }, 'anything');
    expect(result.passed).toBe(false);
    expect(result.errors![0]).toContain('must factor');
  });

  it('factoring introduces tighter intermediate types', () => {
    // Start loose: Spec → Code (Code has 'none' validator)
    const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'none' } };
    const Code: ArtifactType = { name: 'Code', validator: { kind: 'none' } };
    const loose = morphism('implement', Spec, Code, body);

    // Factor through a tighter intermediate: CompilingTS has a real validator
    const CompilingTS: ArtifactType = {
      name: 'CompilingTS',
      validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
    };
    const generate = morphism('generate', Spec, CompilingTS, body);
    const integrate = morphism('integrate', CompilingTS, Code, body);

    // The factoring type-checks: boundaries preserved
    const rw = factor(loose, CompilingTS, generate, integrate);
    const rwType = checkRewrite(rw);
    expect(typesEqual(rwType.source.dom, Spec)).toBe(true);
    expect(typesEqual(rwType.source.cod, Code)).toBe(true);

    // The intermediate type is TIGHTER: CompilingTS has a real validator
    // while Code only had 'none'. The factoring introduced a checkable boundary.
    expect(CompilingTS.validator.kind).toBe('command');
  });

  it('trace retry tightens through error feedback', async () => {
    // Simulate the ratchet: each retry adds constraints
    //   Attempt 1: Spec → Code (loose)
    //   Attempt 2: Spec → CompilingCode (tighter — learned from compile error)
    //   Attempt 3: Spec ⊗ APIConstraints → CompilingCode (tighter — learned from API error)

    const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'schema' } };
    const ErrorCtx: ArtifactType = { name: 'ErrorCtx', validator: { kind: 'none' } };
    const CompilingCode: ArtifactType = {
      name: 'CompilingCode',
      validator: { kind: 'command', command: 'echo', args: ['ok'], expectedExit: 0 },
    };

    const bodyDom = productType([Spec, ErrorCtx]);
    const bodyCod = sumType(CompilingCode, ErrorCtx);
    const tryCompile = morphism('tryCompile', bodyDom, bodyCod, { kind: 'agent', prompt: 'generate code' });

    // Simulate: fail twice with progressively richer error context, then succeed
    const errorContexts: unknown[] = [];
    let attempt = 0;

    const ratchetExecutor: BodyExecutor = async (_body, input) => {
      attempt++;
      const [_spec, errorCtx] = input.value as [unknown, unknown];
      errorContexts.push(errorCtx);

      if (attempt === 1) {
        // First attempt: compile error
        return { tag: 'right', value: 'SyntaxError: unexpected token' } as SumValue;
      }
      if (attempt === 2) {
        // Second attempt: type error (learned from syntax, but still failing)
        return { tag: 'right', value: 'TypeError: missing interface export' } as SumValue;
      }
      // Third attempt: success (learned from both errors)
      return { tag: 'left', value: 'export const handler = () => {}' } as SumValue;
    };

    const t = trace(ErrorCtx, null, tryCompile);
    const input: Artifact = { type: Spec, value: JSON.stringify({ task: 'implement handler' }) };
    const result = await signalExecute(t, input, ratchetExecutor);

    // Verify: 3 attempts, each with richer error context
    expect(attempt).toBe(3);
    expect(errorContexts[0]).toBeNull(); // initial state
    expect(errorContexts[1]).toBe('SyntaxError: unexpected token'); // first error
    expect(errorContexts[2]).toBe('TypeError: missing interface export'); // second error

    // Final output has the tighter type (CompilingCode with real validator)
    expect(result.type.validator.kind).toBe('command');
  });

  it('factoring cascade: none → factor → tighter types at each level', () => {
    // Level 0: Spec → DeliveredProduct (both 'none' — too loose to execute)
    const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'none' } };
    const Delivered: ArtifactType = { name: 'Delivered', validator: { kind: 'none' } };
    const top = morphism('deliver', Spec, Delivered, body);

    // Level 1: Factor into Code and Tested
    const Code: ArtifactType = { name: 'Code', validator: { kind: 'schema' } };
    const Tested: ArtifactType = {
      name: 'Tested',
      validator: { kind: 'command', command: 'npx', args: ['vitest'], expectedExit: 0 },
    };
    const write = morphism('write', Spec, Code, body);
    const test = morphism('test', Code, Tested, body);
    // Note: Tested != Delivered, but that's because factoring refines the codomain.
    // In practice, the factoring would use Delivered as cod of test.
    // For this test, demonstrate the factoring through Code.
    const deploy = morphism('deploy', Tested, Delivered, body);
    const writeAndTest = compose(write, compose(test, deploy));

    // The factored version has TIGHTER intermediate types:
    // Code (schema validator) and Tested (command validator) are both
    // checkable, while the original Spec→Delivered had only 'none' validators.
    const writeType = inferType(write);
    const testType = inferType(test);
    expect(writeType.cod.validator.kind).toBe('schema');
    expect(testType.cod.validator.kind).toBe('command');

    // The pipeline type-checks end-to-end
    const pipelineType = inferType(writeAndTest);
    expect(typesEqual(pipelineType.dom, Spec)).toBe(true);
    expect(typesEqual(pipelineType.cod, Delivered)).toBe(true);
  });
});
