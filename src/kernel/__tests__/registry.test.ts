import { describe, it, expect } from 'vitest';
import { MorphismRegistry } from '../registry.js';
import type { MorphismDef } from '../registry.js';
import type { ArtifactType } from '../types.js';

const A: ArtifactType = { name: 'A', validator: { kind: 'none' } };
const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };
const C: ArtifactType = {
  name: 'C',
  validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
};

describe('MorphismRegistry', () => {
  it('register and find', () => {
    const reg = new MorphismRegistry();
    const def: MorphismDef = {
      name: 'parse',
      fromType: A,
      toType: B,
      body: { kind: 'tool', command: 'jq', args: ['.'] },
    };
    reg.register(def);
    expect(reg.findMorphisms(A, B)).toHaveLength(1);
    expect(reg.findMorphisms(B, A)).toHaveLength(0);
  });

  it('find by name', () => {
    const reg = new MorphismRegistry();
    reg.register({
      name: 'parse',
      fromType: A,
      toType: B,
      body: { kind: 'tool', command: 'jq', args: ['.'] },
    });
    expect(reg.get('parse')).toBeDefined();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('canonical morphism', () => {
    const reg = new MorphismRegistry();
    reg.register({
      name: 'parse',
      fromType: A,
      toType: B,
      body: { kind: 'tool', command: 'parse', args: [] },
    });
    reg.register({
      name: 'coerce',
      fromType: A,
      toType: B,
      body: { kind: 'tool', command: 'coerce', args: [] },
    });
    expect(reg.findCanonical(A, B)).toBeUndefined();

    reg.setCanonical('parse');
    expect(reg.findCanonical(A, B)?.name).toBe('parse');
  });

  it('duplicate name throws', () => {
    const reg = new MorphismRegistry();
    reg.register({
      name: 'parse',
      fromType: A,
      toType: B,
      body: { kind: 'tool', command: 'x', args: [] },
    });
    expect(() =>
      reg.register({
        name: 'parse',
        fromType: B,
        toType: C,
        body: { kind: 'tool', command: 'y', args: [] },
      }),
    ).toThrow(/already registered/);
  });

  it('set canonical for unknown name throws', () => {
    const reg = new MorphismRegistry();
    expect(() => reg.setCanonical('nonexistent')).toThrow(/not found/);
  });

  it('all() returns all registered morphisms', () => {
    const reg = new MorphismRegistry();
    reg.register({ name: 'a', fromType: A, toType: B, body: { kind: 'agent', prompt: '' } });
    reg.register({ name: 'b', fromType: B, toType: C, body: { kind: 'agent', prompt: '' } });
    expect(reg.all()).toHaveLength(2);
  });

  it('multiple morphisms for same type pair', () => {
    const reg = new MorphismRegistry();
    reg.register({ name: 'parse1', fromType: A, toType: B, body: { kind: 'agent', prompt: '' } });
    reg.register({ name: 'parse2', fromType: A, toType: B, body: { kind: 'agent', prompt: '' } });
    expect(reg.findMorphisms(A, B)).toHaveLength(2);
  });
});
