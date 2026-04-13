import { describe, it, expect } from 'vitest';
import { signalExecute, ExecutionError } from '../signal-executor.js';
import type { Artifact, BodyExecutor, SumValue } from '../signal-executor.js';
import { morphism, compose, tensor, trace, id, productType, sumType, UnitType } from '../types.js';
import type { ArtifactType } from '../types.js';

// --- Fixture types ---

const RawText: ArtifactType = { name: 'RawText', validator: { kind: 'none' } };
const ValidJSON: ArtifactType = { name: 'ValidJSON', validator: { kind: 'schema' } };
const CompilingTS: ArtifactType = {
  name: 'CompilingTS',
  validator: { kind: 'command', command: 'echo', args: ['ok'], expectedExit: 0 },
};

// --- Mock executors ---

/** Labels output with morphism name and passes input through. */
const labelExecutor: BodyExecutor = async (body, input) => {
  switch (body.kind) {
    case 'agent':
      return JSON.stringify({ agent: body.prompt, input: input.value });
    case 'tool':
      return JSON.stringify({ tool: body.command, input: input.value });
    case 'human':
      return JSON.stringify({ human: body.description, input: input.value });
    case 'plan':
      return JSON.stringify({ plan: body.description, input: input.value });
  }
};

// --- Identity ---

describe('signalExecute — identity', () => {
  it('passes input through unchanged', async () => {
    const input: Artifact = { type: RawText, value: 'hello' };
    const result = await signalExecute(id(RawText), input, labelExecutor);
    expect(result.value).toBe('hello');
  });
});

// --- Morphism ---

describe('signalExecute — morphism', () => {
  it('executes a single morphism and validates output', async () => {
    const m = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'generate' });
    const input: Artifact = { type: RawText, value: 'start' };
    const result = await signalExecute(m, input, labelExecutor);

    const parsed = JSON.parse(result.value as string);
    expect(parsed.agent).toBe('generate');
    expect(parsed.input).toBe('start');
  });

  it('throws ExecutionError on validation failure', async () => {
    const m = morphism('bad', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const input: Artifact = { type: RawText, value: 'start' };

    const badExecutor: BodyExecutor = async () => 'not json {{{';
    await expect(signalExecute(m, input, badExecutor)).rejects.toThrow(ExecutionError);
    await expect(signalExecute(m, input, badExecutor)).rejects.toThrow(/Validation failed/);
  });
});

// --- Compose ---

describe('signalExecute — compose', () => {
  it('wires first output to second input', async () => {
    const f = morphism('step1', RawText, ValidJSON, { kind: 'agent', prompt: 'first' });
    const g = morphism('step2', ValidJSON, ValidJSON, { kind: 'tool', command: 'jq', args: [] });
    const pipeline = compose(f, g);
    const input: Artifact = { type: RawText, value: 'origin' };

    const result = await signalExecute(pipeline, input, labelExecutor);
    const parsed = JSON.parse(result.value as string);
    expect(parsed.tool).toBe('jq');
    // The input to step2 should be step1's output (JSON string)
    expect(typeof parsed.input).toBe('string');
  });

  it('handles three-step pipeline', async () => {
    const f = morphism('a', RawText, ValidJSON, { kind: 'agent', prompt: 'a' });
    const g = morphism('b', ValidJSON, ValidJSON, { kind: 'tool', command: 'b', args: [] });
    const h = morphism('c', ValidJSON, ValidJSON, { kind: 'tool', command: 'c', args: [] });
    const pipeline = compose(compose(f, g), h);
    const input: Artifact = { type: RawText, value: 'start' };

    const result = await signalExecute(pipeline, input, labelExecutor);
    const parsed = JSON.parse(result.value as string);
    expect(parsed.tool).toBe('c');
  });
});

// --- Tensor ---

describe('signalExecute — tensor', () => {
  it('executes branches in parallel', async () => {
    const f = morphism('left', RawText, ValidJSON, { kind: 'agent', prompt: 'left-work' });
    const g = morphism('right', RawText, ValidJSON, { kind: 'agent', prompt: 'right-work' });
    const par = tensor(f, g);

    const input: Artifact = {
      type: productType([RawText, RawText]),
      value: ['left-in', 'right-in'],
    };

    const result = await signalExecute(par, input, labelExecutor);
    expect(Array.isArray(result.value)).toBe(true);
    const [leftOut, rightOut] = result.value as [string, string];

    expect(JSON.parse(leftOut).agent).toBe('left-work');
    expect(JSON.parse(leftOut).input).toBe('left-in');
    expect(JSON.parse(rightOut).agent).toBe('right-work');
    expect(JSON.parse(rightOut).input).toBe('right-in');
  });

  it('actually runs concurrently', async () => {
    const events: string[] = [];

    const concurrencyExecutor: BodyExecutor = async (body, input) => {
      const name = body.kind === 'agent' ? body.prompt : 'unknown';
      events.push(`${name}:start`);
      // Simulate async work
      await new Promise(r => setTimeout(r, 10));
      events.push(`${name}:end`);
      return JSON.stringify({ name });
    };

    const f = morphism('left', RawText, ValidJSON, { kind: 'agent', prompt: 'L' });
    const g = morphism('right', RawText, ValidJSON, { kind: 'agent', prompt: 'R' });
    const par = tensor(f, g);

    const input: Artifact = {
      type: productType([RawText, RawText]),
      value: ['a', 'b'],
    };

    await signalExecute(par, input, concurrencyExecutor);

    // Both should start before either ends (concurrent, not sequential)
    const lStart = events.indexOf('L:start');
    const rStart = events.indexOf('R:start');
    const lEnd = events.indexOf('L:end');
    const rEnd = events.indexOf('R:end');

    expect(lStart).toBeLessThan(lEnd);
    expect(rStart).toBeLessThan(rEnd);
    // Both start before either ends
    expect(lStart).toBeLessThan(rEnd);
    expect(rStart).toBeLessThan(lEnd);
  });

  it('handles tensor with unit (single branch)', async () => {
    const f = morphism('only', RawText, ValidJSON, { kind: 'agent', prompt: 'solo' });
    const par = tensor(f, id(UnitType));

    // productType([RawText, UnitType]) collapses to RawText
    const input: Artifact = { type: RawText, value: 'solo-in' };

    const result = await signalExecute(par, input, labelExecutor);
    // Output should be [ValidJSON_value, null] combined as product
    // But since right is id(Unit), output product collapses
    expect(result.value).toBeDefined();
  });
});

// --- Trace ---

describe('signalExecute — trace (conditional retry)', () => {
  it('exits immediately on left injection', async () => {
    // body: A⊗S → B+S where body always returns Left(result)
    const ErrorCtx: ArtifactType = { name: 'ErrorCtx', validator: { kind: 'none' } };
    const Output: ArtifactType = { name: 'Output', validator: { kind: 'schema' } };

    const bodyDom = productType([RawText, ErrorCtx]);
    const bodyCod = sumType(Output, ErrorCtx);
    const body = morphism('tryOnce', bodyDom, bodyCod, { kind: 'agent', prompt: 'try' });

    // Executor that always succeeds (left injection)
    const succeedExecutor: BodyExecutor = async (_body, input) => {
      const sum: SumValue = { tag: 'left', value: JSON.stringify({ success: true }) };
      return sum;
    };

    const t = trace(ErrorCtx, null, body);
    const input: Artifact = { type: RawText, value: 'task' };
    const result = await signalExecute(t, input, succeedExecutor);

    expect(result.value).toBe(JSON.stringify({ success: true }));
  });

  it('retries on right injection then exits', async () => {
    const ErrorCtx: ArtifactType = { name: 'ErrorCtx', validator: { kind: 'none' } };
    const Output: ArtifactType = { name: 'Output', validator: { kind: 'schema' } };

    const bodyDom = productType([RawText, ErrorCtx]);
    const bodyCod = sumType(Output, ErrorCtx);
    const body = morphism('retryable', bodyDom, bodyCod, { kind: 'agent', prompt: 'try' });

    let attempts = 0;
    const retryExecutor: BodyExecutor = async (_body, input) => {
      attempts++;
      if (attempts < 3) {
        // Retry: right injection with error context
        const sum: SumValue = { tag: 'right', value: `error on attempt ${attempts}` };
        return sum;
      }
      // Success: left injection
      const sum: SumValue = { tag: 'left', value: JSON.stringify({ attempt: attempts }) };
      return sum;
    };

    const t = trace(ErrorCtx, null, body);
    const input: Artifact = { type: RawText, value: 'task' };
    const result = await signalExecute(t, input, retryExecutor);

    expect(attempts).toBe(3);
    const parsed = JSON.parse(result.value as string);
    expect(parsed.attempt).toBe(3);
  });

  it('state feeds back through iterations', async () => {
    const Counter: ArtifactType = { name: 'Counter', validator: { kind: 'none' } };
    const Result: ArtifactType = { name: 'Result', validator: { kind: 'schema' } };

    const bodyDom = productType([RawText, Counter]);
    const bodyCod = sumType(Result, Counter);
    const body = morphism('countUp', bodyDom, bodyCod, { kind: 'agent', prompt: 'count' });

    const states: unknown[] = [];
    const countExecutor: BodyExecutor = async (_body, input) => {
      const [_taskValue, state] = input.value as [unknown, unknown];
      states.push(state);
      const count = (typeof state === 'number' ? state : 0) + 1;
      if (count >= 5) {
        return { tag: 'left', value: JSON.stringify({ final: count }) } as SumValue;
      }
      return { tag: 'right', value: count } as SumValue;
    };

    const t = trace(Counter, 0, body);
    const input: Artifact = { type: RawText, value: 'go' };
    const result = await signalExecute(t, input, countExecutor);

    // Should iterate 5 times: state 0,1,2,3,4 → exit at 5
    expect(states).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.parse(result.value as string).final).toBe(5);
  });

  it('aborts after max iterations', async () => {
    const S: ArtifactType = { name: 'S', validator: { kind: 'none' } };
    const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };

    const bodyDom = productType([RawText, S]);
    const bodyCod = sumType(B, S);
    const body = morphism('diverge', bodyDom, bodyCod, { kind: 'agent', prompt: 'loop' });

    // Always retries, never exits
    const infiniteExecutor: BodyExecutor = async () => {
      return { tag: 'right', value: 'still going' } as SumValue;
    };

    const t = trace(S, null, body);
    const input: Artifact = { type: RawText, value: 'task' };

    await expect(
      signalExecute(t, input, infiniteExecutor, { maxTraceIterations: 5 }),
    ).rejects.toThrow(/did not converge after 5 iterations/);
  });

  it('rejects non-SumValue from trace body', async () => {
    const S: ArtifactType = { name: 'S', validator: { kind: 'none' } };
    const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };

    const bodyDom = productType([RawText, S]);
    const bodyCod = sumType(B, S);
    const body = morphism('bad', bodyDom, bodyCod, { kind: 'agent', prompt: 'x' });

    // Returns plain value instead of SumValue
    const badExecutor: BodyExecutor = async () => 'not a sum value';

    const t = trace(S, null, body);
    const input: Artifact = { type: RawText, value: 'task' };

    await expect(signalExecute(t, input, badExecutor)).rejects.toThrow(/SumValue/);
  });
});

// --- Nested structures ---

describe('signalExecute — nested', () => {
  it('tensor inside compose', async () => {
    // compose(split, tensor(f, g))
    // split: A → B⊗C, then f⊗g: B⊗C → D⊗E
    const A: ArtifactType = { name: 'A', validator: { kind: 'schema' } };
    const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };
    const C: ArtifactType = { name: 'C', validator: { kind: 'schema' } };
    const BC = productType([B, C]);
    const D: ArtifactType = { name: 'D', validator: { kind: 'schema' } };
    const E: ArtifactType = { name: 'E', validator: { kind: 'schema' } };

    const split = morphism('split', A, BC, { kind: 'tool', command: 'split', args: [] });
    const f = morphism('processB', B, D, { kind: 'agent', prompt: 'handleB' });
    const g = morphism('processC', C, E, { kind: 'agent', prompt: 'handleC' });

    const pipeline = compose(split, tensor(f, g));

    // split executor returns a product value (valid JSON strings for schema validators)
    const nestedExecutor: BodyExecutor = async (body, input) => {
      if (body.kind === 'tool' && body.command === 'split') {
        return [JSON.stringify('partB'), JSON.stringify('partC')];
      }
      if (body.kind === 'agent') {
        return JSON.stringify({ processed: input.value, by: body.prompt });
      }
      return JSON.stringify({});
    };

    const input: Artifact = { type: A, value: 'whole' };
    const result = await signalExecute(pipeline, input, nestedExecutor);

    expect(Array.isArray(result.value)).toBe(true);
    const [dOut, eOut] = result.value as [string, string];
    expect(JSON.parse(dOut).processed).toBe('"partB"');
    expect(JSON.parse(eOut).processed).toBe('"partC"');
  });

  it('compose inside tensor', async () => {
    // tensor(compose(f,g), h) — left branch is sequential, right is independent
    const A: ArtifactType = { name: 'A', validator: { kind: 'none' } };
    const M: ArtifactType = { name: 'M', validator: { kind: 'schema' } };
    const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };
    const C: ArtifactType = { name: 'C', validator: { kind: 'none' } };
    const D: ArtifactType = { name: 'D', validator: { kind: 'schema' } };

    const f = morphism('f', A, M, { kind: 'agent', prompt: 'f' });
    const g = morphism('g', M, B, { kind: 'agent', prompt: 'g' });
    const h = morphism('h', C, D, { kind: 'agent', prompt: 'h' });

    const term = tensor(compose(f, g), h);
    const input: Artifact = {
      type: productType([A, C]),
      value: ['left-in', 'right-in'],
    };

    const result = await signalExecute(term, input, labelExecutor);
    expect(Array.isArray(result.value)).toBe(true);
  });
});
