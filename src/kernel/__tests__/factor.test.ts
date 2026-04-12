import { describe, it, expect } from 'vitest';
import { applyFactoring } from '../factor.js';
import { morphism } from '../types.js';
import { inferType, typesEqual, TypeError } from '../type-check.js';
import type { ArtifactType } from '../types.js';

const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'llm_output' } };
const Code: ArtifactType = { name: 'Code', validator: { kind: 'valid_json' } };
const Tested: ArtifactType = { name: 'Tested', validator: { kind: 'passes_tests', suite: 'unit' } };

describe('applyFactoring', () => {
  it('accepts a valid factoring', () => {
    const original = morphism('deliver', Spec, Tested, { kind: 'human', description: 'build it' });
    const first = morphism('write', Spec, Code, { kind: 'agent', prompt: 'write code' });
    const second = morphism('test', Code, Tested, { kind: 'tool', command: 'vitest', args: ['run'] });

    const result = applyFactoring({ original, intermediate: Code, first, second });
    expect(result).not.toBeInstanceOf(TypeError);

    // The result should compose correctly
    const composed = inferType(result as any);
    expect(typesEqual(composed.dom, Spec)).toBe(true);
    expect(typesEqual(composed.cod, Tested)).toBe(true);
  });

  it('rejects factoring with wrong domain', () => {
    const original = morphism('deliver', Spec, Tested, { kind: 'human', description: 'x' });
    const first = morphism('write', Code, Code, { kind: 'agent', prompt: 'x' }); // wrong domain
    const second = morphism('test', Code, Tested, { kind: 'tool', command: 'x', args: [] });

    const result = applyFactoring({ original, intermediate: Code, first, second });
    expect(result).toBeInstanceOf(TypeError);
    expect((result as TypeError).message).toMatch(/domain mismatch/);
  });

  it('rejects factoring with wrong intermediate (first cod)', () => {
    const original = morphism('deliver', Spec, Tested, { kind: 'human', description: 'x' });
    const first = morphism('write', Spec, Tested, { kind: 'agent', prompt: 'x' }); // cod != intermediate
    const second = morphism('test', Code, Tested, { kind: 'tool', command: 'x', args: [] });

    const result = applyFactoring({ original, intermediate: Code, first, second });
    expect(result).toBeInstanceOf(TypeError);
    expect((result as TypeError).message).toMatch(/intermediate mismatch/);
  });

  it('rejects factoring with wrong intermediate (second dom)', () => {
    const original = morphism('deliver', Spec, Tested, { kind: 'human', description: 'x' });
    const first = morphism('write', Spec, Code, { kind: 'agent', prompt: 'x' });
    const second = morphism('test', Spec, Tested, { kind: 'tool', command: 'x', args: [] }); // dom != intermediate

    const result = applyFactoring({ original, intermediate: Code, first, second });
    expect(result).toBeInstanceOf(TypeError);
    expect((result as TypeError).message).toMatch(/intermediate mismatch/);
  });

  it('rejects factoring with wrong codomain', () => {
    const original = morphism('deliver', Spec, Tested, { kind: 'human', description: 'x' });
    const first = morphism('write', Spec, Code, { kind: 'agent', prompt: 'x' });
    const second = morphism('test', Code, Spec, { kind: 'tool', command: 'x', args: [] }); // cod != original.cod

    const result = applyFactoring({ original, intermediate: Code, first, second });
    expect(result).toBeInstanceOf(TypeError);
    expect((result as TypeError).message).toMatch(/codomain mismatch/);
  });
});
