import { describe, it, expect } from 'vitest';
import { validate } from '../validate.js';
import type { ValidatorSpec } from '../types.js';

describe('none', () => {
  it('always fails with factoring message', async () => {
    const result = await validate({ kind: 'none' }, 'anything');
    expect(result.passed).toBe(false);
    expect(result.errors![0]).toMatch(/factor/i);
  });
});

describe('human', () => {
  it('always fails and surfaces the prompt', async () => {
    const result = await validate({ kind: 'human', prompt: 'Is this correct?' }, 'anything');
    expect(result.passed).toBe(false);
    expect(result.errors![0]).toContain('Is this correct?');
  });
});

describe('schema', () => {
  it('passes valid JSON with no schema constraint', async () => {
    const result = await validate({ kind: 'schema' }, '{"x": 1}');
    expect(result.passed).toBe(true);
  });

  it('fails non-JSON string', async () => {
    const result = await validate({ kind: 'schema' }, 'not json');
    expect(result.passed).toBe(false);
  });

  it('fails non-string artifact', async () => {
    const result = await validate({ kind: 'schema' }, 42);
    expect(result.passed).toBe(false);
  });

  it('passes when artifact satisfies schema', async () => {
    const spec: ValidatorSpec = {
      kind: 'schema',
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    };
    const result = await validate(spec, JSON.stringify({ name: 'hello' }));
    expect(result.passed).toBe(true);
  });

  it('fails when artifact violates schema', async () => {
    const spec: ValidatorSpec = {
      kind: 'schema',
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    };
    const result = await validate(spec, JSON.stringify({ count: 3 }));
    expect(result.passed).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

describe('command', () => {
  it('passes when command exits with expectedExit=0', async () => {
    const result = await validate(
      { kind: 'command', command: 'true', args: [], expectedExit: 0 },
      null,
    );
    expect(result.passed).toBe(true);
  });

  it('fails when command exits with wrong code', async () => {
    const result = await validate(
      { kind: 'command', command: 'false', args: [], expectedExit: 0 },
      null,
    );
    expect(result.passed).toBe(false);
  });

  it('passes when expectedExit matches non-zero exit', async () => {
    const result = await validate(
      { kind: 'command', command: 'false', args: [], expectedExit: 1 },
      null,
    );
    expect(result.passed).toBe(true);
  });
});

describe('tensor', () => {
  it('passes when all checks pass', async () => {
    const spec: ValidatorSpec = {
      kind: 'tensor',
      checks: [
        { kind: 'schema' },
        { kind: 'schema' },
      ],
    };
    const result = await validate(spec, '{}');
    expect(result.passed).toBe(true);
  });

  it('fails and collects all errors when multiple checks fail', async () => {
    const spec: ValidatorSpec = {
      kind: 'tensor',
      checks: [
        { kind: 'none' },
        { kind: 'human', prompt: 'check this' },
      ],
    };
    const result = await validate(spec, 'x');
    expect(result.passed).toBe(false);
    expect(result.errors!.length).toBe(2);
  });

  it('empty tensor passes (monoidal unit)', async () => {
    const result = await validate({ kind: 'tensor', checks: [] }, null);
    expect(result.passed).toBe(true);
  });
});

describe('sequence', () => {
  it('passes when all steps pass', async () => {
    const spec: ValidatorSpec = {
      kind: 'sequence',
      steps: [
        { kind: 'schema' },
        { kind: 'command', command: 'true', args: [], expectedExit: 0 },
      ],
    };
    const result = await validate(spec, '{}');
    expect(result.passed).toBe(true);
  });

  it('stops and returns first failure', async () => {
    let secondRan = false;
    // Use none as guaranteed failure; second step would also fail but we only see the first
    const spec: ValidatorSpec = {
      kind: 'sequence',
      steps: [
        { kind: 'none' },
        { kind: 'human', prompt: 'should not reach' },
      ],
    };
    const result = await validate(spec, 'x');
    expect(result.passed).toBe(false);
    // Only one error: the none, not the human
    expect(result.errors!.length).toBe(1);
    expect(result.errors![0]).toMatch(/factor/i);
  });
});

describe('none forces factoring', () => {
  it('a morphism codomain with none cannot be validated', async () => {
    // The semantic invariant: none is not just "fails" — it means the type is
    // structurally unvalidatable and the morphism must be factored.
    const result = await validate({ kind: 'none' }, 'any artifact');
    expect(result.passed).toBe(false);
    expect(result.errors![0]).toMatch(/factor/i);
  });
});
