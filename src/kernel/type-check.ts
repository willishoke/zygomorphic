/**
 * type-check.ts — Type inference and validation for categorical terms.
 *
 * Every term has a domain (input type) and codomain (output type).
 * Composition requires cod(first) = dom(second).
 * Tensor produces product types on domain and codomain.
 * Trace requires body : A⊗S -> B⊗S, inferring the external type from the body.
 *
 * Migrated from tropical's type_check.ts with 100% logic transfer.
 */

import type { ArtifactType, ValidatorSpec, Term } from './types.js';
import { UnitType, isUnit, productType } from './types.js';

// --- Type comparison ---

export interface MorphismType {
  dom: ArtifactType;
  cod: ArtifactType;
}

export class TypeError extends Error {
  override name = 'TypeError';
  constructor(message: string) {
    super(message);
  }
}

function validatorSpecEqual(a: ValidatorSpec, b: ValidatorSpec): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'none':
      return true;
    case 'human':
      return a.prompt === (b as typeof a).prompt;
    case 'command':
      return a.command === (b as typeof a).command
        && a.expectedExit === (b as typeof a).expectedExit
        && JSON.stringify(a.args) === JSON.stringify((b as typeof a).args);
    case 'schema':
      return JSON.stringify(a.schema) === JSON.stringify((b as typeof a).schema);
    case 'tensor': {
      const bt = b as typeof a;
      if (a.checks.length !== bt.checks.length) return false;
      return a.checks.every((c, i) => validatorSpecEqual(c, bt.checks[i]));
    }
    case 'sequence': {
      const bs = b as typeof a;
      if (a.steps.length !== bs.steps.length) return false;
      return a.steps.every((s, i) => validatorSpecEqual(s, bs.steps[i]));
    }
  }
}

export function typesEqual(a: ArtifactType, b: ArtifactType): boolean {
  return a.name === b.name && validatorSpecEqual(a.validator, b.validator);
}

// --- Type inference ---

/**
 * Infer the domain and codomain of a term.
 * Throws TypeError if the term is ill-typed.
 */
export function inferType(term: Term): MorphismType {
  switch (term.tag) {
    case 'id':
      return { dom: term.portType, cod: term.portType };

    case 'morphism':
      return { dom: term.dom, cod: term.cod };

    case 'compose': {
      const first = inferType(term.first);
      const second = inferType(term.second);
      if (!typesEqual(first.cod, second.dom)) {
        throw new TypeError(
          `Composition type mismatch: first term has codomain "${first.cod.name}" `
          + `but second term has domain "${second.dom.name}"`,
        );
      }
      return { dom: first.dom, cod: second.cod };
    }

    case 'tensor': {
      const left = inferType(term.left);
      const right = inferType(term.right);
      return {
        dom: productType([left.dom, right.dom]),
        cod: productType([left.cod, right.cod]),
      };
    }

    case 'trace': {
      const bodyType = inferType(term.body);
      // body must be A⊗S -> B⊗S
      const domFactors = splitTraceType(bodyType.dom, term.stateType);
      const codFactors = splitTraceType(bodyType.cod, term.stateType);

      if (domFactors === null) {
        throw new TypeError(
          `Trace: body domain ${bodyType.dom.name} does not contain `
          + `state type ${term.stateType.name}`,
        );
      }
      if (codFactors === null) {
        throw new TypeError(
          `Trace: body codomain ${bodyType.cod.name} does not contain `
          + `state type ${term.stateType.name}`,
        );
      }

      return { dom: domFactors.rest, cod: codFactors.rest };
    }
  }
}

/**
 * Given a type that should be of the form A⊗S, split out S and return the rest (A).
 * S is expected to be the last factor in a product.
 * Returns null if S is not found.
 *
 * From tropical type_check.ts:98-134.
 */
function splitTraceType(
  t: ArtifactType,
  stateType: ArtifactType,
): { rest: ArtifactType } | null {
  // If the whole thing is the state type, the "rest" is Unit
  if (typesEqual(t, stateType)) {
    return { rest: UnitType };
  }

  // If it's a product (tensor validator with named factors), check trailing factors
  if (t.validator.kind === 'tensor') {
    const checks = t.validator.checks;
    const names = t.name.split(' \u2297 ');

    // Only proceed if we can decompose into individual factors
    if (checks.length !== names.length || checks.length < 2) return null;

    const factors: ArtifactType[] = checks.map((c, i) => ({
      name: names[i],
      validator: c,
    }));

    if (stateType.validator.kind === 'tensor') {
      // Compound state: match last N factors
      const stateChecks = stateType.validator.checks;
      const stateNames = stateType.name.split(' \u2297 ');
      if (stateChecks.length !== stateNames.length) return null;
      const n = stateChecks.length;
      if (factors.length <= n) return null;

      const tail = factors.slice(factors.length - n);
      const tailType = productType(tail);
      if (typesEqual(tailType, stateType)) {
        return { rest: productType(factors.slice(0, factors.length - n)) };
      }
      return null;
    }

    // Scalar state: match last single factor
    const last = factors[factors.length - 1];
    if (typesEqual(last, stateType)) {
      return { rest: productType(factors.slice(0, -1)) };
    }

    return null;
  }

  return null;
}

/**
 * Type-check a term, returning the inferred type.
 * Convenience wrapper that catches and rethrows with context.
 */
export function typeCheck(term: Term, context?: string): MorphismType {
  try {
    return inferType(term);
  } catch (e) {
    if (e instanceof TypeError && context) {
      throw new TypeError(`${context}: ${e.message}`);
    }
    throw e;
  }
}
