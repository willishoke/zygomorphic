/**
 * cell-ops-instances.ts — CellOps instantiations at Level 1 and Level 2.
 *
 * Level 1 (execution): CellOps<ArtifactType, Term>
 *   - Objects are types, cells are terms
 *   - source/target = inferType().dom/cod
 *
 * Level 2 (planning): CellOps<Term, Rewrite>
 *   - Objects are terms, cells are rewrites
 *   - source/target = rewriteSource/rewriteTarget
 *
 * The "no meta-level" principle is mechanically enforced: planning and
 * execution use the same generic functions with different type parameters.
 */

import type { CellOps } from './cell-ops.js';
import type { ArtifactType, Term } from './types.js';
import type { Rewrite } from './rewrite.js';
import * as T from './types.js';
import { inferType, typesEqual } from './type-check.js';
import { termEqual } from './optimizer.js';
import {
  id2, factor, vertical, horizontal,
  rewriteSource, rewriteTarget,
} from './rewrite.js';

// --- Level 1: CellOps<ArtifactType, Term> ---

export const termOps: CellOps<ArtifactType, Term> = {
  source(cell: Term): ArtifactType {
    return inferType(cell).dom;
  },
  target(cell: Term): ArtifactType {
    return inferType(cell).cod;
  },
  id(obj: ArtifactType): Term {
    return T.id(obj);
  },
  compose(first: Term, second: Term): Term {
    return T.compose(first, second);
  },
  tensor(left: Term, right: Term): Term {
    return T.tensor(left, right);
  },
  objEqual(a: ArtifactType, b: ArtifactType): boolean {
    return typesEqual(a, b);
  },
};

// --- Level 2: CellOps<Term, Rewrite> ---

export const rewriteOps: CellOps<Term, Rewrite> = {
  source(cell: Rewrite): Term {
    return rewriteSource(cell);
  },
  target(cell: Rewrite): Term {
    return rewriteTarget(cell);
  },
  id(obj: Term): Rewrite {
    return id2(obj);
  },
  compose(first: Rewrite, second: Rewrite): Rewrite {
    return vertical(first, second);
  },
  tensor(left: Rewrite, right: Rewrite): Rewrite {
    return horizontal(left, right);
  },
  objEqual(a: Term, b: Term): boolean {
    return termEqual(a, b);
  },
};
