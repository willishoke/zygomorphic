/**
 * cell-ops.test.ts — Verify the generic CellOps interface at both levels.
 *
 * The same test patterns run against Level 1 (ArtifactType/Term) and
 * Level 2 (Term/Rewrite), demonstrating that planning and execution
 * use the same categorical structure.
 */

import { describe, it, expect } from 'vitest';
import { checkCompose, cellBoundary, isIdentity, CellTypeError } from '../cell-ops.js';
import { termOps, rewriteOps } from '../cell-ops-instances.js';
import { morphism, compose, tensor, id } from '../types.js';
import { typesEqual } from '../type-check.js';
import { termEqual } from '../optimizer.js';
import { id2, factor } from '../rewrite.js';
import type { ArtifactType } from '../types.js';

// --- Fixture types ---

const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'none' } };
const Code: ArtifactType = { name: 'Code', validator: { kind: 'schema' } };
const Tested: ArtifactType = {
  name: 'Tested',
  validator: { kind: 'command', command: 'npx', args: ['vitest', 'run'], expectedExit: 0 },
};

const body = { kind: 'agent' as const, prompt: '' };

// --- Level 1: CellOps<ArtifactType, Term> ---

describe('Level 1: termOps', () => {
  it('source/target extract domain/codomain', () => {
    const f = morphism('f', Spec, Code, body);
    expect(typesEqual(termOps.source(f), Spec)).toBe(true);
    expect(typesEqual(termOps.target(f), Code)).toBe(true);
  });

  it('id produces identity term', () => {
    const idCell = termOps.id(Spec);
    expect(idCell.tag).toBe('id');
    expect(typesEqual(termOps.source(idCell), Spec)).toBe(true);
    expect(typesEqual(termOps.target(idCell), Spec)).toBe(true);
  });

  it('compose is sequential', () => {
    const f = morphism('f', Spec, Code, body);
    const g = morphism('g', Code, Tested, body);
    const fg = termOps.compose(f, g);
    expect(typesEqual(termOps.source(fg), Spec)).toBe(true);
    expect(typesEqual(termOps.target(fg), Tested)).toBe(true);
  });

  it('tensor is parallel', () => {
    const f = morphism('f', Spec, Code, body);
    const g = morphism('g', Code, Tested, body);
    const fg = termOps.tensor(f, g);
    // Domain is product, codomain is product
    expect(termOps.source(fg)).toBeDefined();
    expect(termOps.target(fg)).toBeDefined();
  });

  it('checkCompose validates boundaries', () => {
    const f = morphism('f', Spec, Code, body);
    const g = morphism('g', Code, Tested, body);
    const result = checkCompose(termOps, f, g);
    expect(typesEqual(result.source, Spec)).toBe(true);
    expect(typesEqual(result.target, Tested)).toBe(true);
  });

  it('checkCompose rejects mismatched boundaries', () => {
    const f = morphism('f', Spec, Code, body);
    const g = morphism('g', Spec, Tested, body); // dom(g) != cod(f)
    expect(() => checkCompose(termOps, f, g)).toThrow(CellTypeError);
  });

  it('isIdentity detects identity terms', () => {
    const idTerm = id(Spec);
    expect(isIdentity(termOps, idTerm, termEqual)).toBe(true);
  });

  it('isIdentity rejects non-identity terms', () => {
    const f = morphism('f', Spec, Code, body);
    expect(isIdentity(termOps, f, termEqual)).toBe(false);
  });

  it('cellBoundary extracts source/target', () => {
    const f = morphism('f', Spec, Tested, body);
    const b = cellBoundary(termOps, f);
    expect(typesEqual(b.source, Spec)).toBe(true);
    expect(typesEqual(b.target, Tested)).toBe(true);
  });
});

// --- Level 2: CellOps<Term, Rewrite> ---

describe('Level 2: rewriteOps', () => {
  const f = morphism('deliver', Spec, Tested, body);
  const h = morphism('write', Spec, Code, body);
  const g = morphism('test', Code, Tested, body);

  it('source/target extract source/target 1-cells', () => {
    const r = factor(f, Code, h, g);
    expect(termEqual(rewriteOps.source(r), f)).toBe(true);
    expect(termEqual(rewriteOps.target(r), compose(h, g))).toBe(true);
  });

  it('id produces id_2 rewrite', () => {
    const idCell = rewriteOps.id(f);
    expect(idCell.tag).toBe('id_2');
    expect(termEqual(rewriteOps.source(idCell), f)).toBe(true);
    expect(termEqual(rewriteOps.target(idCell), f)).toBe(true);
  });

  it('compose is vertical composition', () => {
    const r1 = factor(f, Code, h, g);
    const r2 = id2(compose(h, g));
    const v = rewriteOps.compose(r1, r2);
    expect(v.tag).toBe('vertical');
  });

  it('tensor is horizontal composition', () => {
    const rL = factor(f, Code, h, g);
    const rR = id2(morphism('other', Spec, Code, body));
    const hz = rewriteOps.tensor(rL, rR);
    expect(hz.tag).toBe('horizontal');
  });

  it('objEqual compares terms structurally', () => {
    expect(rewriteOps.objEqual(f, f)).toBe(true);
    expect(rewriteOps.objEqual(f, g)).toBe(false);
  });

  it('checkCompose validates vertical boundaries via generic function', () => {
    const r1 = factor(f, Code, h, g);
    const r2 = id2(compose(h, g));
    // r1: f ⟹ h;g  (boundary Spec→Tested)
    // r2: h;g ⟹ h;g (boundary Spec→Tested)
    // Generic checkCompose: target(r1) must equal source(r2) as terms
    const result = checkCompose(rewriteOps, r1, r2);
    expect(termEqual(result.source, f)).toBe(true);
    expect(termEqual(result.target, compose(h, g))).toBe(true);
  });

  it('isIdentity detects id_2 rewrites', () => {
    const rewriteEqual = (a: any, b: any): boolean => {
      if (a.tag !== b.tag) return false;
      if (a.tag === 'id_2' && b.tag === 'id_2') return termEqual(a.cell, b.cell);
      return false;
    };
    expect(isIdentity(rewriteOps, id2(f), rewriteEqual)).toBe(true);
  });
});

// --- Cross-level: same patterns at both levels ---

describe('Cross-level: same generic operations', () => {
  it('identity law holds at Level 1', () => {
    const f = morphism('f', Spec, Code, body);
    const idS = termOps.id(Spec);
    const composed = termOps.compose(idS, f);
    // compose(id(A), f) has same boundary as f
    expect(typesEqual(termOps.source(composed), termOps.source(f))).toBe(true);
    expect(typesEqual(termOps.target(composed), termOps.target(f))).toBe(true);
  });

  it('identity law holds at Level 2', () => {
    const f = morphism('deliver', Spec, Tested, body);
    const idR = rewriteOps.id(f);
    // id_2 has source = target = f
    expect(termEqual(rewriteOps.source(idR), f)).toBe(true);
    expect(termEqual(rewriteOps.target(idR), f)).toBe(true);
  });
});
