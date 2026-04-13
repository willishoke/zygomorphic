import { describe, it, expect } from 'vitest';
import { executeTerm } from '../executor.js';
import type { Artifact, BodyExecutor } from '../executor.js';
import { morphism, compose, trace, left, right, sumType, productType } from '../types.js';
import type { ArtifactType } from '../types.js';

// --- Types ---

const Raw: ArtifactType = { name: 'Raw', validator: { kind: 'none' } };
const Valid: ArtifactType = { name: 'Valid', validator: { kind: 'schema' } };
const Error: ArtifactType = { name: 'Error', validator: { kind: 'schema' } };

// B + S where B = Valid, S = Error
const ValidOrError = sumType(Valid, Error);

// A⊗S input to trace body: Raw ⊗ Error
const RawAndError = productType([Raw, Error]);

// ---

describe('executeTerm: id passthrough', () => {
  it('returns input unchanged', async () => {
    const input: Artifact = { type: Raw, value: 'hello' };
    const result = await executeTerm({ tag: 'id', portType: Raw }, input, async () => '');
    expect(result.value).toBe('hello');
  });
});

describe('executeTerm: single morphism', () => {
  it('runs body and validates output', async () => {
    const m = morphism('gen', Raw, Valid, { kind: 'agent', prompt: 'go' });
    const executor: BodyExecutor = async () => '{"ok":true}';
    const result = await executeTerm(m, { type: Raw, value: 'in' }, executor);
    expect(result.type).toBe(Valid);
    expect(result.value).toBe('{"ok":true}');
  });
});

describe('executeTerm: compose', () => {
  it('chains two morphisms', async () => {
    const f = morphism('f', Raw, Valid, { kind: 'agent', prompt: 'step1' });
    const g = morphism('g', Valid, Valid, { kind: 'tool', command: 'jq', args: [] });
    const calls: string[] = [];
    const executor: BodyExecutor = async (body) => {
      calls.push(body.kind === 'agent' ? 'agent' : 'tool');
      return '{}';
    };
    await executeTerm(compose(f, g), { type: Raw, value: 'x' }, executor);
    expect(calls).toEqual(['agent', 'tool']);
  });
});

describe('conditional trace: exits on left', () => {
  it('exits immediately when body returns left', async () => {
    // body: Raw⊗Error -> Valid+Error
    const body = morphism('attempt', RawAndError, ValidOrError, { kind: 'agent', prompt: 'try' });

    const executor: BodyExecutor = async () => left('{"result":"done"}');

    const result = await executeTerm(
      trace(Error, '""', body),
      { type: Raw, value: 'input' },
      executor,
    );

    expect(result.type.name).toBe('Valid');
    expect(result.value).toBe('{"result":"done"}');
  });
});

describe('conditional trace: retries then exits', () => {
  it('feeds back state on right, exits on left after N retries', async () => {
    const body = morphism('attempt', RawAndError, ValidOrError, { kind: 'agent', prompt: 'try' });

    let callCount = 0;
    const executor: BodyExecutor = async (_body, input) => {
      callCount++;
      const [, state] = input.value as [unknown, unknown];
      // First two calls: return right (retry with updated error state)
      // Third call: return left (success)
      if (callCount < 3) {
        return right(JSON.stringify({ attempt: callCount, prev: state }));
      }
      return left('{"final":true}');
    };

    const result = await executeTerm(
      trace(Error, 'null', body),
      { type: Raw, value: 'start' },
      executor,
    );

    expect(callCount).toBe(3);
    expect(result.value).toBe('{"final":true}');
  });
});

describe('conditional trace: state is threaded correctly', () => {
  it('passes updated state back into body each iteration', async () => {
    const body = morphism('attempt', RawAndError, ValidOrError, { kind: 'agent', prompt: 'x' });

    const statesSeen: unknown[] = [];
    let calls = 0;

    const executor: BodyExecutor = async (_body, input) => {
      const [, state] = input.value as [unknown, unknown];
      statesSeen.push(state);
      calls++;
      if (calls < 3) return right(`"error-${calls}"`);
      return left('{}');
    };

    await executeTerm(
      trace(Error, '"initial"', body),
      { type: Raw, value: 'x' },
      executor,
    );

    expect(statesSeen).toEqual(['"initial"', '"error-1"', '"error-2"']);
  });
});

describe('conditional trace: convergence guard', () => {
  it('throws after maxIterations with no left exit', async () => {
    const body = morphism('loop', RawAndError, ValidOrError, { kind: 'agent', prompt: 'x' });
    const executor: BodyExecutor = async () => right('""');

    await expect(
      executeTerm(trace(Error, '""', body), { type: Raw, value: 'x' }, executor, 5),
    ).rejects.toThrow(/did not converge.*5/i);
  });
});

describe('conditional trace: non-SumValue output throws', () => {
  it('throws if body does not return a tagged injection', async () => {
    const body = morphism('bad', RawAndError, ValidOrError, { kind: 'agent', prompt: 'x' });
    const executor: BodyExecutor = async () => '{"this":"is not a SumValue"}';

    await expect(
      executeTerm(trace(Error, '""', body), { type: Raw, value: 'x' }, executor),
    ).rejects.toThrow(/SumValue/);
  });
});

describe('conditional trace: compose inside trace body', () => {
  it('composes prompt_agent and validate as the trace body', async () => {
    // Mirrors the architecture's canonical trace pattern:
    //   trace(Error, null, compose(prompt_agent, validate_step))
    // The intermediate type between the two steps uses a schema validator
    // (valid JSON) — the agent always produces parseable output.
    const Attempt: ArtifactType = { name: 'Attempt', validator: { kind: 'schema' } };
    const AttemptAndError = productType([Raw, Error]);
    const promptAgent = morphism('prompt', AttemptAndError, Attempt, { kind: 'agent', prompt: 'generate' });
    const validateStep = morphism('validate', Attempt, ValidOrError, { kind: 'tool', command: 'check', args: [] });
    const body = compose(promptAgent, validateStep);

    let attempt = 0;
    const executor: BodyExecutor = async (b, input) => {
      if (b.kind === 'agent') {
        attempt++;
        // Always produce valid JSON so Attempt's schema validator passes
        const state = (input.value as unknown[])[1];
        return JSON.stringify({ attempt, prevError: state });
      }
      // validate_step: fail first two attempts, succeed on third
      if (attempt < 3) return right('"error"');
      return left(JSON.stringify({ validated: true, attempt }));
    };

    const result = await executeTerm(
      trace(Error, 'null', body),
      { type: Raw, value: 'spec' },
      executor,
    );

    expect(JSON.parse(result.value as string)).toMatchObject({ validated: true, attempt: 3 });
  });
});
