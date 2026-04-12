import { describe, it, expect } from 'vitest';
import { inferType, typesEqual, TypeError } from '../type-check.js';
import { id, morphism, compose } from '../types.js';
import type { ArtifactType } from '../types.js';

const RawText: ArtifactType = { name: 'RawText', validator: { kind: 'llm_output' } };
const ValidJSON: ArtifactType = { name: 'ValidJSON', validator: { kind: 'valid_json' } };
const CompilingTS: ArtifactType = { name: 'CompilingTS', validator: { kind: 'compiles', language: 'typescript' } };

describe('typesEqual', () => {
  it('returns true for identical types', () => {
    expect(typesEqual(RawText, RawText)).toBe(true);
    expect(typesEqual(ValidJSON, ValidJSON)).toBe(true);
  });

  it('returns false for different names', () => {
    const a: ArtifactType = { name: 'A', validator: { kind: 'llm_output' } };
    const b: ArtifactType = { name: 'B', validator: { kind: 'llm_output' } };
    expect(typesEqual(a, b)).toBe(false);
  });

  it('returns false for different validators', () => {
    const a: ArtifactType = { name: 'X', validator: { kind: 'llm_output' } };
    const b: ArtifactType = { name: 'X', validator: { kind: 'valid_json' } };
    expect(typesEqual(a, b)).toBe(false);
  });

  it('checks validator parameters', () => {
    const a: ArtifactType = { name: 'Code', validator: { kind: 'compiles', language: 'typescript' } };
    const b: ArtifactType = { name: 'Code', validator: { kind: 'compiles', language: 'rust' } };
    expect(typesEqual(a, b)).toBe(false);
  });
});

describe('inferType', () => {
  it('infers identity type', () => {
    const t = inferType(id(RawText));
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, RawText)).toBe(true);
  });

  it('infers morphism type', () => {
    const m = morphism('parse', RawText, ValidJSON, { kind: 'tool', command: 'jq', args: ['.'] });
    const t = inferType(m);
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, ValidJSON)).toBe(true);
  });

  it('infers composed type with matching boundaries', () => {
    const f = morphism('generate', RawText, ValidJSON, { kind: 'agent', prompt: 'produce json' });
    const g = morphism('compile', ValidJSON, CompilingTS, { kind: 'tool', command: 'tsc', args: [] });
    const t = inferType(compose(f, g));
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, CompilingTS)).toBe(true);
  });

  it('throws TypeError on composition boundary mismatch', () => {
    const f = morphism('generate', RawText, ValidJSON, { kind: 'agent', prompt: 'produce json' });
    const g = morphism('compile', CompilingTS, RawText, { kind: 'tool', command: 'tsc', args: [] });
    expect(() => inferType(compose(f, g))).toThrow(TypeError);
    expect(() => inferType(compose(f, g))).toThrow(/Composition type mismatch/);
  });

  it('infers deeply nested compositions', () => {
    const f = morphism('a', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const g = morphism('b', ValidJSON, CompilingTS, { kind: 'tool', command: 'y', args: [] });
    const h = morphism('c', CompilingTS, RawText, { kind: 'tool', command: 'z', args: [] });
    const t = inferType(compose(compose(f, g), h));
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, RawText)).toBe(true);
  });

  it('composition with identity is valid', () => {
    const f = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const t = inferType(compose(id(RawText), f));
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, ValidJSON)).toBe(true);
  });
});
