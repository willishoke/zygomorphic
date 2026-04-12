/**
 * cell-ops.ts — Generic categorical toolkit.
 *
 * The 2-cell structure is not a second implementation. It's the same
 * implementation, instantiated again. CellOps<Obj, Cell> provides the
 * minimal interface for a category: source/target, identity, compose,
 * tensor, equality. Generic typeCheck and optimize are written once
 * against this interface.
 *
 * Instantiation:
 *   Level 1 (execution): CellOps<ArtifactType, Term>
 *   Level 2 (planning):  CellOps<Term, Rewrite>
 */

// --- Generic interface ---

export interface CellOps<Obj, Cell> {
  /** Source (domain) of a cell. */
  source(cell: Cell): Obj;
  /** Target (codomain) of a cell. */
  target(cell: Cell): Obj;
  /** Identity cell on an object. */
  id(obj: Obj): Cell;
  /** Sequential composition: first then second. */
  compose(first: Cell, second: Cell): Cell;
  /** Parallel composition: left alongside right. */
  tensor(left: Cell, right: Cell): Cell;
  /** Object equality. */
  objEqual(a: Obj, b: Obj): boolean;
}

// --- Generic type checker ---

export class CellTypeError extends Error {
  override name = 'CellTypeError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Type-check a composition: verify that target(first) = source(second).
 * Returns { source, target } of the composite.
 */
export function checkCompose<Obj, Cell>(
  ops: CellOps<Obj, Cell>,
  first: Cell,
  second: Cell,
): { source: Obj; target: Obj } {
  const firstTarget = ops.target(first);
  const secondSource = ops.source(second);
  if (!ops.objEqual(firstTarget, secondSource)) {
    throw new CellTypeError('Composition boundary mismatch');
  }
  return { source: ops.source(first), target: ops.target(second) };
}

/**
 * Verify that a cell is well-formed and return its boundary.
 * This is the generic analog of inferType / checkRewrite.
 */
export function cellBoundary<Obj, Cell>(
  ops: CellOps<Obj, Cell>,
  cell: Cell,
): { source: Obj; target: Obj } {
  return { source: ops.source(cell), target: ops.target(cell) };
}

// --- Generic identity elimination ---

/**
 * Check if a cell is an identity. A cell is identity if source = target
 * and the cell equals id(source). This requires Cell-level equality,
 * which CellOps doesn't mandate — so we take a cellEqual predicate.
 */
export function isIdentity<Obj, Cell>(
  ops: CellOps<Obj, Cell>,
  cell: Cell,
  cellEqual: (a: Cell, b: Cell) => boolean,
): boolean {
  const s = ops.source(cell);
  const t = ops.target(cell);
  if (!ops.objEqual(s, t)) return false;
  return cellEqual(cell, ops.id(s));
}
