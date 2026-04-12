import { describe, it, expect } from 'vitest';
import { inferType, typesEqual, TypeError } from '../type-check.js';
import { id, morphism, compose, tensor, trace, UnitType, productType } from '../types.js';
import type { ArtifactType } from '../types.js';

// --- Fixture types ---

const RawText: ArtifactType = { name: 'RawText', validator: { kind: 'none' } };
const ValidJSON: ArtifactType = { name: 'ValidJSON', validator: { kind: 'schema' } };
const CompilingTS: ArtifactType = {
  name: 'CompilingTS',
  validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
};
const Tested: ArtifactType = {
  name: 'Tested',
  validator: { kind: 'command', command: 'npx', args: ['vitest', 'run'], expectedExit: 0 },
};

describe('typesEqual', () => {
  it('returns true for identical types', () => {
    expect(typesEqual(RawText, RawText)).toBe(true);
    expect(typesEqual(ValidJSON, ValidJSON)).toBe(true);
  });

  it('returns false for different names', () => {
    const a: ArtifactType = { name: 'A', validator: { kind: 'none' } };
    const b: ArtifactType = { name: 'B', validator: { kind: 'none' } };
    expect(typesEqual(a, b)).toBe(false);
  });

  it('returns false for different validators', () => {
    const a: ArtifactType = { name: 'X', validator: { kind: 'none' } };
    const b: ArtifactType = { name: 'X', validator: { kind: 'schema' } };
    expect(typesEqual(a, b)).toBe(false);
  });

  it('checks command validator parameters', () => {
    const a: ArtifactType = {
      name: 'Code',
      validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
    };
    const b: ArtifactType = {
      name: 'Code',
      validator: { kind: 'command', command: 'rustc', args: [], expectedExit: 0 },
    };
    expect(typesEqual(a, b)).toBe(false);
  });

  it('compares tensor validators structurally', () => {
    const a: ArtifactType = {
      name: 'A \u2297 B',
      validator: { kind: 'tensor', checks: [{ kind: 'none' }, { kind: 'schema' }] },
    };
    const b: ArtifactType = {
      name: 'A \u2297 B',
      validator: { kind: 'tensor', checks: [{ kind: 'none' }, { kind: 'schema' }] },
    };
    const c: ArtifactType = {
      name: 'A \u2297 B',
      validator: { kind: 'tensor', checks: [{ kind: 'schema' }, { kind: 'none' }] },
    };
    expect(typesEqual(a, b)).toBe(true);
    expect(typesEqual(a, c)).toBe(false);
  });

  it('compares sequence validators structurally', () => {
    const a: ArtifactType = {
      name: 'X',
      validator: { kind: 'sequence', steps: [{ kind: 'schema' }, { kind: 'none' }] },
    };
    const b: ArtifactType = {
      name: 'X',
      validator: { kind: 'sequence', steps: [{ kind: 'schema' }, { kind: 'none' }] },
    };
    expect(typesEqual(a, b)).toBe(true);
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

describe('inferType — tensor', () => {
  it('infers tensor product types', () => {
    const f = morphism('f', RawText, ValidJSON, { kind: 'agent', prompt: '' });
    const g = morphism('g', CompilingTS, Tested, { kind: 'tool', command: 'x', args: [] });
    const t = inferType(tensor(f, g));
    expect(typesEqual(t.dom, productType([RawText, CompilingTS]))).toBe(true);
    expect(typesEqual(t.cod, productType([ValidJSON, Tested]))).toBe(true);
  });

  it('tensor with unit preserves type', () => {
    const f = morphism('f', RawText, ValidJSON, { kind: 'agent', prompt: '' });
    const t = inferType(tensor(f, id(UnitType)));
    // productType([RawText, UnitType]) = RawText (unit eliminated)
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, ValidJSON)).toBe(true);
  });
});

describe('inferType — trace', () => {
  it('traces out state type from product', () => {
    // body: (RawText ⊗ ValidJSON) -> (CompilingTS ⊗ ValidJSON), state = ValidJSON
    // trace should produce: RawText -> CompilingTS
    const dom = productType([RawText, ValidJSON]);
    const cod = productType([CompilingTS, ValidJSON]);
    const body = morphism('f', dom, cod, { kind: 'agent', prompt: '' });
    const t = inferType(trace(ValidJSON, null, body));
    expect(typesEqual(t.dom, RawText)).toBe(true);
    expect(typesEqual(t.cod, CompilingTS)).toBe(true);
  });

  it('trace where entire type is state produces Unit', () => {
    // body: RawText -> RawText, state = RawText
    // trace should produce: Unit -> Unit
    const body = morphism('f', RawText, RawText, { kind: 'agent', prompt: '' });
    const t = inferType(trace(RawText, null, body));
    expect(typesEqual(t.dom, UnitType)).toBe(true);
    expect(typesEqual(t.cod, UnitType)).toBe(true);
  });

  it('trace with wrong state type throws', () => {
    const body = morphism('f', RawText, ValidJSON, { kind: 'agent', prompt: '' });
    expect(() => inferType(trace(CompilingTS, null, body))).toThrow(TypeError);
  });
});
