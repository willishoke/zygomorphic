/**
 * laws.test.ts — Property-based verification of categorical laws.
 *
 * Proves that the migrated categorical core satisfies monoidal category axioms
 * using fast-check random testing. Adapted from tropical's term.test.ts.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  id, morphism, compose, tensor,
  UnitType, productType,
} from '../types.js';
import type { ArtifactType, Term, MorphismBody } from '../types.js';
import { inferType, typesEqual } from '../type-check.js';
import { optimize, eliminateIdentity, flattenCompose, termEqual, termSize } from '../optimizer.js';

// --- Arbitrary generators ---

const body: MorphismBody = { kind: 'agent', prompt: '' };

/** Generate a random ArtifactType. */
const typeA: ArtifactType = { name: 'A', validator: { kind: 'none' } };
const typeB: ArtifactType = { name: 'B', validator: { kind: 'schema' } };
const typeC: ArtifactType = {
  name: 'C',
  validator: { kind: 'command', command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
};
const typeD: ArtifactType = { name: 'D', validator: { kind: 'human', prompt: 'review' } };

const arbArtifactType: fc.Arbitrary<ArtifactType> = fc.oneof(
  fc.constant(typeA),
  fc.constant(typeB),
  fc.constant(typeC),
  fc.constant(typeD),
);

/** Generate a well-typed morphism term with given domain and codomain. */
function arbMorphism(dom: ArtifactType, cod: ArtifactType): fc.Arbitrary<Term> {
  return fc.string({ minLength: 1, maxLength: 8 }).map(name =>
    morphism(name, dom, cod, body),
  );
}

/**
 * Generate a random well-typed term given a fixed domain and codomain.
 * Avoids the filter() trap — we never generate terms that might not compose.
 */
function arbTermTyped(dom: ArtifactType, cod: ArtifactType, maxDepth: number): fc.Arbitrary<Term> {
  if (maxDepth <= 0) {
    return arbMorphism(dom, cod);
  }

  return fc.oneof(
    // Base: morphism
    { weight: 3, arbitrary: arbMorphism(dom, cod) },

    // Identity (only when types match)
    ...(typesEqual(dom, cod)
      ? [{ weight: 1, arbitrary: fc.constant(id(dom)) }]
      : []),

    // Compose: pick a random midpoint type
    {
      weight: 2,
      arbitrary: arbArtifactType.chain(mid =>
        fc.tuple(
          arbTermTyped(dom, mid, maxDepth - 1),
          arbTermTyped(mid, cod, maxDepth - 1),
        ).map(([f, g]) => compose(f, g)),
      ),
    },
  );
}

/** Generate a random well-typed term with random domain and codomain. */
function arbTerm(maxDepth: number): fc.Arbitrary<{ term: Term; dom: ArtifactType; cod: ArtifactType }> {
  return fc.tuple(arbArtifactType, arbArtifactType).chain(([dom, cod]) =>
    arbTermTyped(dom, cod, maxDepth).map(term => ({ term, dom, cod })),
  );
}

// --- Categorical laws ---

describe('categorical laws (property-based)', () => {
  it('identity law: compose(id, f) has same type as f', () => {
    fc.assert(
      fc.property(arbTerm(1), ({ term, dom, cod }) => {
        const withId = compose(id(dom), term);
        const t = inferType(withId);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 200 },
    );
  });

  it('identity law: compose(f, id) has same type as f', () => {
    fc.assert(
      fc.property(arbTerm(1), ({ term, dom, cod }) => {
        const withId = compose(term, id(cod));
        const t = inferType(withId);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 200 },
    );
  });

  it('associativity: compose(compose(f,g),h) same type as compose(f,compose(g,h))', () => {
    fc.assert(
      fc.property(
        arbArtifactType, arbArtifactType, arbArtifactType, arbArtifactType,
        (a, b, c, d) => {
          const f = morphism('f', a, b, body);
          const g = morphism('g', b, c, body);
          const h = morphism('h', c, d, body);
          const left = inferType(compose(compose(f, g), h));
          const right = inferType(compose(f, compose(g, h)));
          return typesEqual(left.dom, right.dom) && typesEqual(left.cod, right.cod);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('tensor is bifunctorial: types compose correctly', () => {
    fc.assert(
      fc.property(
        arbTerm(0), arbTerm(0),
        ({ term: f, dom: a, cod: b }, { term: g, dom: c, cod: d }) => {
          const t = inferType(tensor(f, g));
          return typesEqual(t.dom, productType([a, c]))
            && typesEqual(t.cod, productType([b, d]));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('interchange law: tensor(compose(f1,g1), compose(f2,g2)) same type as compose(tensor(f1,f2), tensor(g1,g2))', () => {
    fc.assert(
      fc.property(
        arbArtifactType, arbArtifactType, arbArtifactType,
        arbArtifactType, arbArtifactType, arbArtifactType,
        (a, b, c, d, e, ft) => {
          const f1 = morphism('f1', a, b, body);
          const g1 = morphism('g1', b, c, body);
          const f2 = morphism('f2', d, e, body);
          const g2 = morphism('g2', e, ft, body);

          const left = inferType(tensor(compose(f1, g1), compose(f2, g2)));
          const right = inferType(compose(tensor(f1, f2), tensor(g1, g2)));

          return typesEqual(left.dom, right.dom) && typesEqual(left.cod, right.cod);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('unit law: tensor(f, id(Unit)) has same type as f', () => {
    fc.assert(
      fc.property(arbTerm(1), ({ term, dom, cod }) => {
        const t = inferType(tensor(term, id(UnitType)));
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 200 },
    );
  });

  it('random well-typed terms always type-check', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term, dom, cod }) => {
        const t = inferType(term);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 500 },
    );
  });
});

// --- Optimizer type preservation ---

describe('optimizer type preservation (property-based)', () => {
  it('eliminateIdentity preserves types', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term, dom, cod }) => {
        const opt = eliminateIdentity(term);
        const t = inferType(opt);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 300 },
    );
  });

  it('flattenCompose preserves types', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term, dom, cod }) => {
        const opt = flattenCompose(term);
        const t = inferType(opt);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 300 },
    );
  });

  it('optimize preserves types', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term, dom, cod }) => {
        const opt = optimize(term);
        const t = inferType(opt);
        return typesEqual(t.dom, dom) && typesEqual(t.cod, cod);
      }),
      { numRuns: 300 },
    );
  });

  it('optimize never increases term size', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term }) => {
        const opt = optimize(term);
        return termSize(opt) <= termSize(term);
      }),
      { numRuns: 300 },
    );
  });

  it('optimize is idempotent', () => {
    fc.assert(
      fc.property(arbTerm(2), ({ term }) => {
        const once = optimize(term);
        const twice = optimize(once);
        return termEqual(once, twice);
      }),
      { numRuns: 300 },
    );
  });
});
