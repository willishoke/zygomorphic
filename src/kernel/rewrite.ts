/**
 * rewrite.ts — 2-cell structure for the categorical execution engine.
 *
 * Every graph mutation is a sequence of factor/fuse operations.
 * Factoring IS a 2-morphism: α: f ⟹ g ∘ h.
 * Every factoring has an inverse (fuse). Rewindability is typed.
 *
 * 2-cell composition:
 *   vertical:   factor, then factor a child (α then β)
 *   horizontal: factor parallel branches independently (α ⊗ β)
 *   identity:   leave a morphism unchanged
 *
 * The 2-cell type checker verifies boundary preservation:
 *   dom(source) = dom(target) and cod(source) = cod(target)
 */

import type { ArtifactType, Term, Autonomy } from './types.js';
import { compose, tensor } from './types.js';
import { inferType, typesEqual, TypeError } from './type-check.js';
import type { MorphismType } from './type-check.js';

// --- 2-cell (Rewrite) type ---

export type Rewrite =
  | { tag: 'id_2'; cell: Term }
  | { tag: 'factor'; source: Term; intermediate: ArtifactType;
      first: Term; second: Term; autonomy: Autonomy }
  | { tag: 'fuse'; first: Term; second: Term; fused: Term }
  | { tag: 'vertical'; first: Rewrite; second: Rewrite }
  | { tag: 'horizontal'; left: Rewrite; right: Rewrite }

// --- Constructors ---

export const id2 = (cell: Term): Rewrite =>
  ({ tag: 'id_2', cell });

export const factor = (
  source: Term,
  intermediate: ArtifactType,
  first: Term,
  second: Term,
  autonomy: Autonomy = 'auto',
): Rewrite =>
  ({ tag: 'factor', source, intermediate, first, second, autonomy });

export const fuse = (first: Term, second: Term, fused: Term): Rewrite =>
  ({ tag: 'fuse', first, second, fused });

export const vertical = (first: Rewrite, second: Rewrite): Rewrite =>
  ({ tag: 'vertical', first, second });

export const horizontal = (left: Rewrite, right: Rewrite): Rewrite =>
  ({ tag: 'horizontal', left, right });

// --- Source and target extraction ---

/** The source 1-cell of a rewrite (what it transforms FROM). */
export function rewriteSource(r: Rewrite): Term {
  switch (r.tag) {
    case 'id_2': return r.cell;
    case 'factor': return r.source;
    case 'fuse': return compose(r.first, r.second);
    case 'vertical': return rewriteSource(r.first);
    case 'horizontal': return tensor(rewriteSource(r.left), rewriteSource(r.right));
  }
}

/** The target 1-cell of a rewrite (what it transforms TO). */
export function rewriteTarget(r: Rewrite): Term {
  switch (r.tag) {
    case 'id_2': return r.cell;
    case 'factor': return compose(r.first, r.second);
    case 'fuse': return r.fused;
    case 'vertical': return rewriteTarget(r.second);
    case 'horizontal': return tensor(rewriteTarget(r.left), rewriteTarget(r.right));
  }
}

// --- 2-cell type checker ---

export interface RewriteType {
  /** Boundary of the source 1-cell. */
  source: MorphismType;
  /** Boundary of the target 1-cell. */
  target: MorphismType;
}

/**
 * Type-check a rewrite (2-cell), verifying boundary preservation.
 *
 * A well-typed rewrite α: f ⟹ g satisfies:
 *   dom(f) = dom(g) and cod(f) = cod(g)
 *
 * Returns the boundary types. Throws TypeError on violation.
 */
export function checkRewrite(r: Rewrite): RewriteType {
  switch (r.tag) {
    case 'id_2': {
      const t = inferType(r.cell);
      return { source: t, target: t };
    }

    case 'factor': {
      const sourceType = inferType(r.source);
      const firstType = inferType(r.first);
      const secondType = inferType(r.second);

      // first: A → M
      if (!typesEqual(firstType.dom, sourceType.dom)) {
        throw new TypeError(
          `Factor: first morphism domain "${firstType.dom.name}" `
          + `!= source domain "${sourceType.dom.name}"`,
        );
      }
      if (!typesEqual(firstType.cod, r.intermediate)) {
        throw new TypeError(
          `Factor: first morphism codomain "${firstType.cod.name}" `
          + `!= intermediate type "${r.intermediate.name}"`,
        );
      }

      // second: M → B
      if (!typesEqual(secondType.dom, r.intermediate)) {
        throw new TypeError(
          `Factor: second morphism domain "${secondType.dom.name}" `
          + `!= intermediate type "${r.intermediate.name}"`,
        );
      }
      if (!typesEqual(secondType.cod, sourceType.cod)) {
        throw new TypeError(
          `Factor: second morphism codomain "${secondType.cod.name}" `
          + `!= source codomain "${sourceType.cod.name}"`,
        );
      }

      const targetType = inferType(compose(r.first, r.second));
      return { source: sourceType, target: targetType };
    }

    case 'fuse': {
      const sourceType = inferType(compose(r.first, r.second));
      const targetType = inferType(r.fused);

      if (!typesEqual(sourceType.dom, targetType.dom)) {
        throw new TypeError(
          `Fuse: composed domain "${sourceType.dom.name}" `
          + `!= fused domain "${targetType.dom.name}"`,
        );
      }
      if (!typesEqual(sourceType.cod, targetType.cod)) {
        throw new TypeError(
          `Fuse: composed codomain "${sourceType.cod.name}" `
          + `!= fused codomain "${targetType.cod.name}"`,
        );
      }

      return { source: sourceType, target: targetType };
    }

    case 'vertical': {
      const firstRw = checkRewrite(r.first);
      const secondRw = checkRewrite(r.second);

      // The target of the first rewrite must have the same boundary
      // as the source of the second rewrite (they compose as 2-cells).
      if (!typesEqual(firstRw.target.dom, secondRw.source.dom)
          || !typesEqual(firstRw.target.cod, secondRw.source.cod)) {
        throw new TypeError(
          `Vertical: first rewrite target boundary `
          + `(${firstRw.target.dom.name} → ${firstRw.target.cod.name}) `
          + `!= second rewrite source boundary `
          + `(${secondRw.source.dom.name} → ${secondRw.source.cod.name})`,
        );
      }

      return { source: firstRw.source, target: secondRw.target };
    }

    case 'horizontal': {
      const leftRw = checkRewrite(r.left);
      const rightRw = checkRewrite(r.right);

      // Horizontal composition produces tensor of source/target boundaries.
      // Each side is independently well-typed; the result tensors them.
      return {
        source: {
          dom: inferType(tensor(rewriteSource(r.left), rewriteSource(r.right))).dom,
          cod: inferType(tensor(rewriteSource(r.left), rewriteSource(r.right))).cod,
        },
        target: {
          dom: inferType(tensor(rewriteTarget(r.left), rewriteTarget(r.right))).dom,
          cod: inferType(tensor(rewriteTarget(r.left), rewriteTarget(r.right))).cod,
        },
      };
    }
  }
}

/**
 * Invert a rewrite. Every factor has a fuse inverse and vice versa.
 * Rewindability is typed — the system guarantees every rewrite is undoable.
 */
export function invertRewrite(r: Rewrite): Rewrite {
  switch (r.tag) {
    case 'id_2':
      return r;
    case 'factor':
      return fuse(r.first, r.second, r.source);
    case 'fuse':
      // Fusing back: we need the intermediate type from the composed pair.
      // The intermediate is cod(first) = dom(second).
      return factor(r.fused, inferType(r.first).cod, r.first, r.second);
    case 'vertical':
      // Reverse order and invert each
      return vertical(invertRewrite(r.second), invertRewrite(r.first));
    case 'horizontal':
      return horizontal(invertRewrite(r.left), invertRewrite(r.right));
  }
}

/**
 * Apply a rewrite to produce the target term.
 * This is a convenience for extracting the rewritten graph.
 */
export function applyRewrite(r: Rewrite): Term {
  checkRewrite(r);
  return rewriteTarget(r);
}
