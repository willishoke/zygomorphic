import type { ArtifactType, Term } from './types.js';
import { compose } from './types.js';
import { inferType, typesEqual, TypeError } from './type-check.js';

export interface Factoring {
  original: Term;
  intermediate: ArtifactType;
  first: Term;   // h: A → M
  second: Term;  // g: M → B
}

/** Apply a factoring: type-check that h and g compose correctly and match the original's boundary. */
export function applyFactoring(f: Factoring): Term | TypeError {
  const originalType = inferType(f.original);

  let firstType, secondType;
  try {
    firstType = inferType(f.first);
    secondType = inferType(f.second);
  } catch (e) {
    if (e instanceof TypeError) return e;
    throw e;
  }

  // Check: dom(h) = dom(original)
  if (!typesEqual(firstType.dom, originalType.dom)) {
    return new TypeError(
      `Factoring domain mismatch: first morphism has domain "${firstType.dom.name}" ` +
      `but original has domain "${originalType.dom.name}"`
    );
  }

  // Check: cod(h) = M
  if (!typesEqual(firstType.cod, f.intermediate)) {
    return new TypeError(
      `Factoring intermediate mismatch: first morphism has codomain "${firstType.cod.name}" ` +
      `but intermediate type is "${f.intermediate.name}"`
    );
  }

  // Check: dom(g) = M
  if (!typesEqual(secondType.dom, f.intermediate)) {
    return new TypeError(
      `Factoring intermediate mismatch: second morphism has domain "${secondType.dom.name}" ` +
      `but intermediate type is "${f.intermediate.name}"`
    );
  }

  // Check: cod(g) = cod(original)
  if (!typesEqual(secondType.cod, originalType.cod)) {
    return new TypeError(
      `Factoring codomain mismatch: second morphism has codomain "${secondType.cod.name}" ` +
      `but original has codomain "${originalType.cod.name}"`
    );
  }

  return compose(f.first, f.second);
}
