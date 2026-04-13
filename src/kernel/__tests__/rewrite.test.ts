import { describe, it, expect } from 'vitest';
import {
  id2, factor, fuse, vertical, horizontal,
  rewriteSource, rewriteTarget,
  checkRewrite, invertRewrite, applyRewrite,
} from '../rewrite.js';
import type { Rewrite } from '../rewrite.js';
import { morphism, compose, tensor, id } from '../types.js';
import { inferType, typesEqual, TypeError } from '../type-check.js';
import type { ArtifactType } from '../types.js';

// --- Fixture types ---

const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'none' } };
const Code: ArtifactType = { name: 'Code', validator: { kind: 'schema' } };
const Tested: ArtifactType = {
  name: 'Tested',
  validator: { kind: 'command', command: 'npx', args: ['vitest', 'run'], expectedExit: 0 },
};
const Compiled: ArtifactType = {
  name: 'Compiled',
  validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
};
const Designed: ArtifactType = { name: 'Designed', validator: { kind: 'human', prompt: 'review design' } };

const body = { kind: 'agent' as const, prompt: '' };

describe('id_2', () => {
  it('source and target are the same cell', () => {
    const f = morphism('f', Spec, Tested, body);
    const r = id2(f);
    expect(rewriteSource(r)).toBe(f);
    expect(rewriteTarget(r)).toBe(f);
  });

  it('type-checks with matching boundaries', () => {
    const f = morphism('f', Spec, Tested, body);
    const t = checkRewrite(id2(f));
    expect(typesEqual(t.source.dom, t.target.dom)).toBe(true);
    expect(typesEqual(t.source.cod, t.target.cod)).toBe(true);
  });
});

describe('factor', () => {
  it('produces compose(first, second) as target', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, { kind: 'tool', command: 'vitest', args: ['run'] });

    const r = factor(f, Code, h, g);
    const target = rewriteTarget(r);
    expect(target.tag).toBe('compose');

    const targetType = inferType(target);
    expect(typesEqual(targetType.dom, Spec)).toBe(true);
    expect(typesEqual(targetType.cod, Tested)).toBe(true);
  });

  it('type-checks: boundaries preserved', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, { kind: 'tool', command: 'vitest', args: ['run'] });

    const t = checkRewrite(factor(f, Code, h, g));
    expect(typesEqual(t.source.dom, Spec)).toBe(true);
    expect(typesEqual(t.source.cod, Tested)).toBe(true);
    expect(typesEqual(t.target.dom, Spec)).toBe(true);
    expect(typesEqual(t.target.cod, Tested)).toBe(true);
  });

  it('rejects domain mismatch', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Code, Code, body); // wrong domain
    const g = morphism('test', Code, Tested, body);

    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(TypeError);
    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(/first morphism domain/);
  });

  it('rejects intermediate mismatch', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Compiled, body); // cod != intermediate
    const g = morphism('test', Code, Tested, body);

    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(TypeError);
    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(/first morphism codomain/);
  });

  it('rejects codomain mismatch', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Spec, body); // wrong codomain

    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(TypeError);
    expect(() => checkRewrite(factor(f, Code, h, g))).toThrow(/second morphism codomain/);
  });

  it('carries autonomy annotation', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);

    const r = factor(f, Code, h, g, 'approve');
    expect(r.tag === 'factor' && r.autonomy).toBe('approve');
  });
});

describe('fuse', () => {
  it('collapses composition back to single morphism', () => {
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);
    const f = morphism('deliver', Spec, Tested, body);

    const r = fuse(h, g, f);
    expect(rewriteSource(r).tag).toBe('compose');
    expect(rewriteTarget(r)).toBe(f);
  });

  it('type-checks: boundaries preserved', () => {
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);
    const f = morphism('deliver', Spec, Tested, body);

    const t = checkRewrite(fuse(h, g, f));
    expect(typesEqual(t.source.dom, Spec)).toBe(true);
    expect(typesEqual(t.source.cod, Tested)).toBe(true);
    expect(typesEqual(t.target.dom, Spec)).toBe(true);
    expect(typesEqual(t.target.cod, Tested)).toBe(true);
  });

  it('rejects boundary mismatch', () => {
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);
    const f = morphism('deliver', Code, Tested, body); // wrong domain

    expect(() => checkRewrite(fuse(h, g, f))).toThrow(TypeError);
    expect(() => checkRewrite(fuse(h, g, f))).toThrow(/fused domain/i);
  });
});

describe('vertical composition', () => {
  it('chains factor then factor-child', () => {
    // f: Spec → Tested
    // First rewrite: f ⟹ write ; test
    const f = morphism('deliver', Spec, Tested, body);
    const write = morphism('write', Spec, Code, body);
    const test = morphism('test', Code, Tested, body);
    const r1 = factor(f, Code, write, test);

    // Second rewrite: write ⟹ design ; implement
    const design = morphism('design', Spec, Designed, body);
    const implement = morphism('implement', Designed, Code, body);
    const r2inner = factor(write, Designed, design, implement);

    // The vertical composition needs the second rewrite to operate on
    // the target of the first. But vertical checks boundary compatibility,
    // not structural term equality. Both rewrites operate within Spec→Tested.
    // r1: (Spec→Tested) ⟹ (Spec→Tested)
    // r2inner: (Spec→Code) ⟹ (Spec→Code)
    // For proper vertical: second source boundary must match first target boundary.
    // r1 target boundary is Spec→Tested, r2inner source boundary is Spec→Code. MISMATCH.

    // Correct vertical: second rewrite must also have boundary Spec→Tested.
    // Factor write within the composition: replace write;test with (design;implement);test
    const r2 = factor(
      compose(write, test),  // source: Spec → Tested (the whole composition)
      Designed,
      design,
      compose(implement, test), // second: Designed → Tested
    );

    const v = vertical(r1, r2);
    const t = checkRewrite(v);
    expect(typesEqual(t.source.dom, Spec)).toBe(true);
    expect(typesEqual(t.source.cod, Tested)).toBe(true);
  });

  it('rejects incompatible boundaries', () => {
    const f = morphism('f', Spec, Code, body);
    const g = morphism('g', Code, Tested, body);
    const h = morphism('h', Spec, Tested, body);

    // r1 has boundary Spec→Tested
    const r1 = factor(h, Code, f, g);
    // r2 has boundary Code→Tested — different domain
    const r2 = id2(g);

    expect(() => checkRewrite(vertical(r1, r2))).toThrow(TypeError);
    expect(() => checkRewrite(vertical(r1, r2))).toThrow(/Vertical/);
  });
});

describe('horizontal composition', () => {
  it('tensors independent rewrites', () => {
    // Left: factoring f into h;g
    const fL = morphism('buildFrontend', Spec, Code, body);
    const hL = morphism('designUI', Spec, Designed, body);
    const gL = morphism('implementUI', Designed, Code, body);
    const rL = factor(fL, Designed, hL, gL);

    // Right: identity on a parallel morphism
    const fR = morphism('buildBackend', Spec, Tested, body);
    const rR = id2(fR);

    const h = horizontal(rL, rR);
    const t = checkRewrite(h);

    // Source should be tensor(fL, fR), target should be tensor(compose(hL,gL), fR)
    const srcType = inferType(tensor(fL, fR));
    const tgtType = inferType(tensor(compose(hL, gL), fR));
    expect(typesEqual(t.source.dom, srcType.dom)).toBe(true);
    expect(typesEqual(t.source.cod, srcType.cod)).toBe(true);
    expect(typesEqual(t.target.dom, tgtType.dom)).toBe(true);
    expect(typesEqual(t.target.cod, tgtType.cod)).toBe(true);
  });
});

describe('invertRewrite', () => {
  it('factor inverts to fuse', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);

    const r = factor(f, Code, h, g);
    const inv = invertRewrite(r);
    expect(inv.tag).toBe('fuse');

    // The inverse should type-check
    const t = checkRewrite(inv);
    expect(typesEqual(t.source.dom, Spec)).toBe(true);
    expect(typesEqual(t.source.cod, Tested)).toBe(true);
  });

  it('fuse inverts to factor', () => {
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);
    const f = morphism('deliver', Spec, Tested, body);

    const r = fuse(h, g, f);
    const inv = invertRewrite(r);
    expect(inv.tag).toBe('factor');

    const t = checkRewrite(inv);
    expect(typesEqual(t.source.dom, Spec)).toBe(true);
    expect(typesEqual(t.source.cod, Tested)).toBe(true);
  });

  it('double inversion is identity on boundaries', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);

    const r = factor(f, Code, h, g);
    const t1 = checkRewrite(r);
    const t2 = checkRewrite(invertRewrite(invertRewrite(r)));

    expect(typesEqual(t1.source.dom, t2.source.dom)).toBe(true);
    expect(typesEqual(t1.source.cod, t2.source.cod)).toBe(true);
    expect(typesEqual(t1.target.dom, t2.target.dom)).toBe(true);
    expect(typesEqual(t1.target.cod, t2.target.cod)).toBe(true);
  });

  it('id_2 inverts to itself', () => {
    const f = morphism('f', Spec, Code, body);
    const inv = invertRewrite(id2(f));
    expect(inv.tag).toBe('id_2');
  });

  it('vertical inversion reverses order', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);
    const r1 = factor(f, Code, h, g);
    const r2 = id2(compose(h, g));
    const v = vertical(r1, r2);

    const inv = invertRewrite(v);
    expect(inv.tag).toBe('vertical');
    // Should type-check
    checkRewrite(inv);
  });
});

describe('applyRewrite', () => {
  it('returns the target term after type-checking', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const h = morphism('write', Spec, Code, body);
    const g = morphism('test', Code, Tested, body);

    const result = applyRewrite(factor(f, Code, h, g));
    expect(result.tag).toBe('compose');

    const resultType = inferType(result);
    expect(typesEqual(resultType.dom, Spec)).toBe(true);
    expect(typesEqual(resultType.cod, Tested)).toBe(true);
  });
});
