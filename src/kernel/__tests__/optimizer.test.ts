/**
 * optimizer.test.ts — Tests for categorical term rewriting passes.
 *
 * Adapted from tropical's optimizer.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  optimize,
  eliminateIdentity,
  flattenCompose,
  flattenTensor,
  termSize,
  composeDepth,
  termEqual,
} from '../optimizer.js';
import {
  id, morphism, compose, tensor, trace,
  UnitType, productType,
} from '../types.js';
import type { ArtifactType, Term } from '../types.js';
import { inferType } from '../type-check.js';

// --- Fixtures ---

const A: ArtifactType = { name: 'A', validator: { kind: 'none' } };
const B: ArtifactType = { name: 'B', validator: { kind: 'schema' } };
const C: ArtifactType = {
  name: 'C',
  validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
};
const D: ArtifactType = {
  name: 'D',
  validator: { kind: 'command', command: 'npx', args: ['vitest', 'run'], expectedExit: 0 },
};

const body = { kind: 'agent' as const, prompt: '' };

const f = morphism('f', A, B, body);
const g = morphism('g', B, C, body);
const h = morphism('h', C, D, body);
const p = morphism('p', A, A, body);
const q = morphism('q', A, A, body);

// --- termEqual ---

describe('termEqual', () => {
  it('same morphism', () => {
    expect(termEqual(f, f)).toBe(true);
  });

  it('different morphisms', () => {
    expect(termEqual(f, g)).toBe(false);
  });

  it('id vs morphism', () => {
    expect(termEqual(id(A), f)).toBe(false);
  });

  it('compose equality', () => {
    expect(termEqual(compose(f, g), compose(f, g))).toBe(true);
    expect(termEqual(compose(f, g), compose(g, h))).toBe(false);
  });

  it('tensor equality', () => {
    expect(termEqual(tensor(f, g), tensor(f, g))).toBe(true);
    expect(termEqual(tensor(f, g), tensor(g, f))).toBe(false);
  });
});

// --- termSize ---

describe('termSize', () => {
  it('leaf nodes', () => {
    expect(termSize(f)).toBe(1);
    expect(termSize(id(A))).toBe(1);
  });

  it('compose', () => {
    expect(termSize(compose(f, g))).toBe(3);
  });

  it('nested', () => {
    expect(termSize(compose(compose(f, g), h))).toBe(5);
  });
});

// --- Identity elimination ---

describe('eliminateIdentity', () => {
  it('left identity: compose(id, f) -> f', () => {
    const term = compose(id(A), f);
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, f)).toBe(true);
  });

  it('right identity: compose(f, id) -> f', () => {
    const term = compose(f, id(B));
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, f)).toBe(true);
  });

  it('both identities: compose(id, id) -> id', () => {
    const term = compose(id(A), id(A));
    const opt = eliminateIdentity(term);
    expect(opt.tag).toBe('id');
  });

  it('right unit: tensor(f, id(Unit)) -> f', () => {
    const term = tensor(f, id(UnitType));
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, f)).toBe(true);
  });

  it('left unit: tensor(id(Unit), f) -> f', () => {
    const term = tensor(id(UnitType), f);
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, f)).toBe(true);
  });

  it('non-Unit id in tensor preserved', () => {
    const term = tensor(f, id(A));
    const opt = eliminateIdentity(term);
    expect(opt.tag).toBe('tensor');
  });

  it('nested identity elimination', () => {
    const term = compose(id(A), compose(f, id(B)));
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, f)).toBe(true);
  });

  it('identity inside trace body', () => {
    const AB = productType([A, A]);
    const inner = compose(id(AB), morphism('fb', AB, AB, body));
    const term = trace(A, null, inner);
    const opt = eliminateIdentity(term);
    expect(opt.tag).toBe('trace');
    if (opt.tag === 'trace') {
      expect(opt.body.tag).toBe('morphism');
    }
  });

  it('no change when no identities', () => {
    const term = compose(f, g);
    const opt = eliminateIdentity(term);
    expect(termEqual(opt, term)).toBe(true);
  });

  it('reduces term size', () => {
    const term = compose(id(A), compose(f, id(B)));
    expect(termSize(term)).toBe(5);
    const opt = eliminateIdentity(term);
    expect(termSize(opt)).toBe(1);
  });
});

// --- Compose flattening ---

describe('flattenCompose', () => {
  it('left-associated -> right-associated', () => {
    const term = compose(compose(f, g), h);
    const opt = flattenCompose(term);
    expect(opt.tag).toBe('compose');
    if (opt.tag === 'compose') {
      expect(termEqual(opt.first, f)).toBe(true);
      expect(opt.second.tag).toBe('compose');
      if (opt.second.tag === 'compose') {
        expect(termEqual(opt.second.first, g)).toBe(true);
        expect(termEqual(opt.second.second, h)).toBe(true);
      }
    }
  });

  it('already right-associated — no change', () => {
    const term = compose(f, compose(g, h));
    const opt = flattenCompose(term);
    expect(termEqual(opt, term)).toBe(true);
  });

  it('deeply nested left-association', () => {
    // ((f ; g) ; h) ; p_adapted
    const p_d = morphism('p_d', D, A, body);
    const fgh = compose(compose(f, g), h);
    const term = compose(fgh, p_d);
    const opt = flattenCompose(term);
    expect(composeDepth(term)).toBe(3);
    expect(composeDepth(opt)).toBe(1);
  });

  it('single term unchanged', () => {
    expect(termEqual(flattenCompose(f), f)).toBe(true);
  });

  it('flattens inside tensor', () => {
    const inner = compose(compose(p, p), p);
    const term = tensor(inner, f);
    const opt = flattenCompose(term);
    expect(opt.tag).toBe('tensor');
    if (opt.tag === 'tensor') {
      expect(composeDepth(opt.left)).toBe(1);
    }
  });

  it('flattens inside trace body', () => {
    const AB = productType([A, A]);
    const fb = morphism('fb', AB, AB, body);
    const leftAssoc = compose(compose(fb, fb), fb);
    const term = trace(A, null, leftAssoc);
    const opt = flattenCompose(term);
    expect(opt.tag).toBe('trace');
    if (opt.tag === 'trace') {
      expect(composeDepth(opt.body)).toBe(1);
    }
  });
});

// --- Tensor flattening ---

describe('flattenTensor', () => {
  it('left-associated -> right-associated', () => {
    const term = tensor(tensor(f, g), h);
    const opt = flattenTensor(term);
    expect(opt.tag).toBe('tensor');
    if (opt.tag === 'tensor') {
      expect(termEqual(opt.left, f)).toBe(true);
      expect(opt.right.tag).toBe('tensor');
    }
  });

  it('already right-associated — no change', () => {
    const term = tensor(f, tensor(g, h));
    const opt = flattenTensor(term);
    expect(termEqual(opt, term)).toBe(true);
  });

  it('single term unchanged', () => {
    expect(termEqual(flattenTensor(f), f)).toBe(true);
  });
});

// --- Full optimizer ---

describe('optimize', () => {
  it('combines identity elimination and flattening', () => {
    const term = compose(id(A), compose(compose(f, id(B)), g));
    const opt = optimize(term);
    expect(termEqual(opt, compose(f, g))).toBe(true);
  });

  it('idempotent: optimize(optimize(t)) = optimize(t)', () => {
    const term = compose(id(A), compose(compose(f, id(B)), g));
    const once = optimize(term);
    const twice = optimize(once);
    expect(termEqual(once, twice)).toBe(true);
  });

  it('empty tensor units eliminated', () => {
    const term = tensor(tensor(f, id(UnitType)), id(UnitType));
    const opt = optimize(term);
    expect(termEqual(opt, f)).toBe(true);
  });
});
