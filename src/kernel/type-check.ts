import type { ArtifactType, Term, ValidatorSpec } from './types.js';

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
    case 'llm_output': return true;
    case 'valid_json': return JSON.stringify(a.schema) === JSON.stringify((b as typeof a).schema);
    case 'compiles': return a.language === (b as typeof a).language;
    case 'passes_tests': return a.suite === (b as typeof a).suite;
  }
}

export function typesEqual(a: ArtifactType, b: ArtifactType): boolean {
  return a.name === b.name && validatorSpecEqual(a.validator, b.validator);
}

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
          `Composition type mismatch: first term has codomain "${first.cod.name}" ` +
          `but second term has domain "${second.dom.name}"`
        );
      }
      return { dom: first.dom, cod: second.cod };
    }
  }
}
