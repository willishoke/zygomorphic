/**
 * types.ts — Core types for the categorical execution engine.
 *
 * Objects (0-cells) are ArtifactTypes with executable validators.
 * Morphisms (1-cells) are Terms in the free traced symmetric monoidal category.
 *
 * Migrated from tropical's term.ts with domain adaptation:
 *   PortType (DSP scalars/arrays) -> ArtifactType (executable validators)
 *   MorphismBody (expr/primitive) -> MorphismBody (agent/tool/human/plan)
 */

// --- Objects (0-cells): Types as executable validators ---

export type ValidatorSpec =
  | { kind: 'command'; command: string; args: string[]; expectedExit: number }
  | { kind: 'schema'; schema?: object }
  | { kind: 'tensor'; checks: ValidatorSpec[] }
  | { kind: 'sequence'; steps: ValidatorSpec[] }
  | { kind: 'human'; prompt: string }
  | { kind: 'none' }

export interface ArtifactType {
  name: string;
  validator: ValidatorSpec;
}

/** The monoidal unit. Empty tensor = trivially satisfied, no data. */
export const UnitType: ArtifactType = {
  name: 'Unit',
  validator: { kind: 'tensor', checks: [] },
};

/** Check if a type is the monoidal unit. */
export function isUnit(t: ArtifactType): boolean {
  return t.validator.kind === 'tensor'
    && (t.validator as { checks: ValidatorSpec[] }).checks.length === 0;
}

/**
 * Construct a product type from factors.
 * Mirrors tropical's product(): flattens nested products, eliminates units,
 * unwraps singletons.
 *
 *   productType([A, UnitType, B]) = productType([A, B])
 *   productType([A]) = A
 *   productType([]) = UnitType
 */
export function productType(factors: ArtifactType[]): ArtifactType {
  // Flatten nested products and filter units
  const flat: ArtifactType[] = [];
  for (const f of factors) {
    if (isUnit(f)) continue;
    if (f.validator.kind === 'tensor') {
      // Nested product: extract individual factors by matching name segments
      // A product's checks correspond 1:1 with its named factors
      const checks = (f.validator as { checks: ValidatorSpec[] }).checks;
      const names = f.name.split(' \u2297 ');
      if (checks.length === names.length && checks.length > 1) {
        for (let i = 0; i < checks.length; i++) {
          flat.push({ name: names[i], validator: checks[i] });
        }
      } else {
        flat.push(f);
      }
    } else {
      flat.push(f);
    }
  }
  if (flat.length === 0) return UnitType;
  if (flat.length === 1) return flat[0];
  return {
    name: flat.map(f => f.name).join(' \u2297 '),
    validator: { kind: 'tensor', checks: flat.map(f => f.validator) },
  };
}

/** Human-readable string for an artifact type. */
export function typeToString(t: ArtifactType): string {
  return t.name;
}

// --- Morphisms (1-cells): Terms ---

export type MorphismBody =
  | { kind: 'agent'; prompt: string; model?: string }
  | { kind: 'tool'; command: string; args: string[] }
  | { kind: 'human'; description: string }
  | { kind: 'plan'; description: string }

export type Autonomy = 'auto' | 'approve' | 'manual';

/**
 * Term in the free traced symmetric monoidal category.
 *
 *   id        : A -> A                            (identity / wire)
 *   morphism  : A -> B                            (a named operation)
 *   compose   : (A -> B) x (B -> C) -> (A -> C)   (sequential)
 *   tensor    : (A -> B) x (C -> D) -> (AxC -> BxD) (parallel)
 *   trace     : (AxS -> B+S) -> (A -> B)          (feedback with typed state)
 */
export type Term =
  | { tag: 'id'; portType: ArtifactType }
  | { tag: 'morphism'; name: string; dom: ArtifactType; cod: ArtifactType;
      body: MorphismBody; autonomy: Autonomy }
  | { tag: 'compose'; first: Term; second: Term }
  | { tag: 'tensor'; left: Term; right: Term }
  | { tag: 'trace'; stateType: ArtifactType; init: unknown | null; body: Term }

// --- Constructors ---

export const id = (portType: ArtifactType): Term =>
  ({ tag: 'id', portType });

export const morphism = (
  name: string,
  dom: ArtifactType,
  cod: ArtifactType,
  body: MorphismBody,
  autonomy: Autonomy = 'auto',
): Term =>
  ({ tag: 'morphism', name, dom, cod, body, autonomy });

export const compose = (first: Term, second: Term): Term =>
  ({ tag: 'compose', first, second });

export const tensor = (left: Term, right: Term): Term =>
  ({ tag: 'tensor', left, right });

export const trace = (stateType: ArtifactType, init: unknown | null, body: Term): Term =>
  ({ tag: 'trace', stateType, init, body });

/**
 * Compose a sequence of terms left-to-right: composeAll([f, g, h]) = f ; g ; h
 */
export function composeAll(terms: Term[]): Term {
  if (terms.length === 0) throw new Error('composeAll: empty list');
  return terms.reduce(compose);
}

/**
 * Tensor a list of terms: tensorAll([f, g, h]) = f ⊗ g ⊗ h
 * Returns id(UnitType) for empty list.
 */
export function tensorAll(terms: Term[]): Term {
  if (terms.length === 0) return id(UnitType);
  return terms.reduce(tensor);
}
