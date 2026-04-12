// --- Objects (0-cells): Types as executable validators ---

export type ValidatorSpec =
  | { kind: 'llm_output' }
  | { kind: 'valid_json'; schema?: object }
  | { kind: 'compiles'; language: string }
  | { kind: 'passes_tests'; suite: string }

export interface ArtifactType {
  name: string;
  validator: ValidatorSpec;
}

// --- Morphisms (1-cells): Terms ---

export type MorphismBody =
  | { kind: 'agent'; prompt: string; model?: string }
  | { kind: 'tool'; command: string; args: string[] }
  | { kind: 'human'; description: string }

export type Term =
  | { tag: 'id'; portType: ArtifactType }
  | { tag: 'morphism'; name: string; dom: ArtifactType; cod: ArtifactType; body: MorphismBody }
  | { tag: 'compose'; first: Term; second: Term }

// --- Constructors ---

export const id = (portType: ArtifactType): Term => ({ tag: 'id', portType });

export const morphism = (
  name: string,
  dom: ArtifactType,
  cod: ArtifactType,
  body: MorphismBody,
): Term => ({ tag: 'morphism', name, dom, cod, body });

export const compose = (first: Term, second: Term): Term => ({ tag: 'compose', first, second });
