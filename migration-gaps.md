# Migration Gap Analysis: What Tropical Doesn't Cover

Tropical's categorical core (term language, type inference, optimizer, dependency graph, toposort, cycle detection, morphism registry) migrates to zygomorphic with type-level renames and covers roughly 40% of the architecture. This document covers the remaining 60%.

---

## 1. ArtifactType and ValidatorSpec (arch \S1, \S6)

PR 32's `ValidatorSpec` has 4 ad-hoc kinds (`llm_output`, `valid_json`, `compiles`, `passes_tests`). The architecture specifies a different taxonomy:

```typescript
type ValidatorSpec =
  | { kind: 'command'; command: string; args: string[]; expectedExit: number }
  | { kind: 'schema'; schema: JSONSchema }
  | { kind: 'tensor'; checks: ValidatorSpec[] }       // parallel independent checks
  | { kind: 'sequence'; steps: ValidatorSpec[] }      // sequential dependent checks
  | { kind: 'human'; prompt: string }                 // requires human judgment
  | { kind: 'none' }                                  // unvalidatable, must factor
```

Key differences from PR 32:
- `tensor` and `sequence` are **composed validators** (theorems, not axioms) -- they combine primitives
- `none` is the **factoring pressure mechanism**: a morphism with `none` codomain validator cannot execute and must be decomposed
- `schema` validates against JSON Schema, not just parsability
- `command` generalizes `compiles` and `passes_tests` into a single shell-exec primitive
- `human` introduces human-in-the-loop as a first-class validator kind

The validator IS the type. `ArtifactType` is not an abstract label -- it's a named executable predicate. Composition validity is subtyping: `cod(f) <: dom(g)` means f's output satisfies g's input validator.

### Bootstrap kernel (arch \S6.5)

Five primitive validators that exist before the system runs:

1. `is_valid_json(schema)` -- parse + schema check
2. `is_valid_syntax(language)` -- call language parser
3. `passes_tests(suite)` -- run test harness
4. `matches_regex(pattern)` -- string validation
5. `human_review(prompt)` -- human-in-the-loop

These are axioms. Composed validators (tensor/sequence of primitives) are theorems.

---

## 2. Conditional Trace (arch \S1.3, \S1.4)

This is the single biggest semantic divergence from tropical.

Tropical's trace has product-type codomain: `A ⊗ S -> B ⊗ S`. State always feeds back. This models DSP feedback loops where the loop always runs.

Zygomorphic's trace has **sum-type codomain**: `A ⊗ S -> B + S`. Left injection (B) exits the trace. Right injection (S) feeds back with error context. The trace only emits through the Output path.

This domesticates LLM nondeterminism: the output type is a **guarantee**, not a probability. The retry loop for "produce valid code":

```
trace(Error, null,
  compose(prompt_agent, validate)
  with feedback: format_error
)
```

### What this requires

- A sum type in the type system (tropical has `SumType` as an opaque named type, but not as a structural `Either<A, B>` with injection/projection)
- Modified `splitTraceType` that extracts the state type from a sum codomain rather than a product codomain
- Modified trace execution semantics: check which injection the output is, branch on it
- The three atoms (arch \S9): `prompt_agent`, `validate`, `format_error` -- everything else is composition around these

---

## 3. 2-Cell Structure: Rewrite Type (arch \S3)

Factoring is not a side operation on the graph. It IS a 2-morphism. PR 32's `factor.ts` has a basic `applyFactoring` function but no 2-cell type, no inverse, no composition.

### Required type

```typescript
type Rewrite =
  | { tag: 'id_2'; cell: Term }                                    // leave unchanged
  | { tag: 'factor'; source: Term; target: Term;
      intermediate: ArtifactType; first: Term; second: Term;
      autonomy: Autonomy }                                         // f => g . h
  | { tag: 'fuse'; source: Term; target: Term }                   // g . h => f (inverse)
  | { tag: 'vertical'; first: Rewrite; second: Rewrite }          // factor, then factor child
  | { tag: 'horizontal'; left: Rewrite; right: Rewrite }          // factor parallel branches
```

### 2-cell type checker

Verifies boundary preservation: `dom(source) = dom(target)` and `cod(source) = cod(target)`. Factoring must preserve the morphism's typed interface.

### Rewind

Every factoring has an inverse (fuse). Rewindability is typed -- the system guarantees every factoring is undoable. The 2-cell log (git history of morphism files) preserves context without imposing tree structure.

### Connection to \S4 (Generic Toolkit)

The 2-cell structure is not a second implementation. It's the same `CellOps<Obj, Cell>` interface, instantiated at a different level:

| | Level 1 (execution) | Level 2 (planning) |
|---|---|---|
| Obj | ArtifactType | Term |
| Cell | Term | Rewrite |
| source | dom(term) | original morphism |
| target | cod(term) | factored composition |

---

## 4. Generic CellOps\<Obj, Cell\> Toolkit (arch \S4)

The type checker, optimizer, and composition logic should be written once and instantiated at each level:

```typescript
interface CellOps<Obj, Cell> {
  source(cell: Cell): Obj;
  target(cell: Cell): Obj;
  id(obj: Obj): Cell;
  compose(first: Cell, second: Cell): Cell;
  tensor(left: Cell, right: Cell): Cell;
  objEqual(a: Obj, b: Obj): boolean;
}

function typeCheck<Obj, Cell>(ops: CellOps<Obj, Cell>, cell: Cell): { source: Obj; target: Obj }
function optimize<Obj, Cell>(ops: CellOps<Obj, Cell>, cell: Cell): Cell
```

Tropical's `inferType` and `optimize` are concrete (hardcoded to `PortType`/`Term`). They need to be lifted to this generic interface so the same code handles both execution-level type checking and planning-level (2-cell) type checking.

The trace at level N handles "try, fail, retry" at that level -- no N+1 cells needed. Traces are the regress-stopper.

---

## 5. Signal/Slot Executor (arch \S5)

PR 32's executor is a linear pipeline: flatten to list, iterate sequentially. The architecture specifies a fundamentally different model.

### Core semantics

- Each output wire is a signal; each input wire is a slot
- A node fires when **all** its slots are filled
- No global barrier, no epochs -- maximal async parallelism
- Topological sort derives tensor/compose from declared dependencies
- Critical path emerges from signal propagation

### Design principle

No component has global graph visibility. The dependency structure is encoded in the wiring. Any coordinator with global visibility reintroduces the flat-planner cognitive load the system eliminates. Locality is load-bearing.

### Tensor semantics

`f ⊗ g` means causal independence -- no data dependency between branches. Independence is ENFORCED by workspace isolation: tensor decomposition produces parallel git branches. Branches share no mutable state. A merge conflict between tensor branches is a type error surfaced late.

### Dynamic graph mutation

Lock-free. Factoring at runtime is append-only: create nodes, wire them, set forwarding pointer from original output slot to new subgraph's terminal, enqueue. Existing concurrent nodes never read new structure. Rewind is localized cancellation owned by the trace that created the region.

### Implementation notes

This is the highest-effort new component. It requires:
- An event loop / task scheduler that respects the signal/slot firing rules
- Slot aggregation (a node with multiple inputs waits for all)
- Forwarding pointers for live factoring
- Integration with the autonomy model (approve gates block signal propagation until human acts)

---

## 6. Autonomy Model (arch \S7)

Annotation on the factoring 2-cell, not on the morphism itself:

- **auto**: agent factors and proceeds
- **approve**: agent proposes, human reviews before factoring takes effect
- **manual**: human draws the split

### Human feedback type

```
human_review: Proposal -> Approved(Factoring)
                        + Rejected(Reason)
                        + Edited(ModifiedFactoring)
                        + Restructured(AlternativeFactoring)
```

### Escalation

An agent in `auto` whose trace isn't converging promotes itself to `approve`. Autonomy is a floor, not a ceiling.

### No inter-agent communication

Typed boundaries are the complete interface contract. Agents are scoped: input type, output type, nothing else.

---

## 7. Morphism Persistence (arch \S8)

The architecture specifies markdown-as-truth with derived SQLite index (extending PR 32's `store.ts` pattern):

### Morphism file format

```markdown
---
id: implement_auth
domain: APISpec ⊗ SecurityReqs
codomain: CompilingTypeScript<AuthMiddleware>
autonomy: auto
status: pending
factored_from: implement_backend
validator:
  kind: tensor
  checks:
    - { kind: command, command: tsc, args: ["--noEmit", "src/auth.ts"], expectedExit: 0 }
    - { kind: command, command: jest, args: ["--testPathPattern", "auth"], expectedExit: 0 }
---

Implement JWT auth middleware.

## Decision log
- httpOnly cookies over localStorage (compliance)
- JWT over sessions (stateless scaling)
```

Files live in `.zygomorphic/plan/`. The dependency graph is derived (SQLite), rebuilt from morphism files. Execution state is in-memory and ephemeral. Factoring history is `git log` of morphism files.

PR 32's `store.ts` already implements the markdown-as-truth + SQLite-as-index pattern for workspace nodes. The morphism persistence layer follows the same pattern with different frontmatter keys and a different directory.

---

## 8. Git Integration (arch \S8)

- Tensor decomposition produces parallel git branches (enforces causal isolation)
- Typed boundary validation runs as CI checks on PRs
- Composition (sequential work) merges a PR
- `git log --follow .zygomorphic/plan/` = factoring history

This is architecturally independent of the categorical core -- it's an integration layer that maps categorical operations to git operations. But it's load-bearing for the tensor isolation guarantee.

---

## 9. Type Refinement Ratchet (arch \S6.4)

Types start weak and get refined through failure:

```
Attempt 1: Spec -> Code                           (too loose)
Attempt 2: Spec -> CompilingCode                   (tighter)
Attempt 3: Spec ⊗ APIConstraints -> CompilingCode<I>   (learned from failure)
```

Types are cumulative learning. Each failure tightens the validator. Type bloat signals wrong factoring -- pressure toward better decomposition.

This is not a separate component but a behavioral property that emerges from:
- The conditional trace (retry feeds back error context)
- The `none` validator (forces factoring)
- The 2-cell structure (factoring introduces intermediate types)
- The validator-as-type principle (tighter validator = tighter type)

---

## 10. Validation Impossibility Drives Factoring (arch \S6.3)

A morphism whose codomain has `validator: { kind: 'none' }` CANNOT execute -- it must factor. The tree grows downward until every leaf has a constructible validator. The frontier of unfactored morphisms IS the set of morphisms with unvalidatable codomains.

Two failure modes, two mechanisms:
- "I tried and failed the check" -> trace iterates (local)
- "There is no check" -> must factor (structural)

---

## Priority ordering

1. **ArtifactType + ValidatorSpec** -- foundation everything else builds on
2. **Conditional trace** -- the key semantic primitive; without it the retry/guarantee model doesn't work
3. **2-cell structure** -- factor/fuse with typed boundaries; required for any planning operations
4. **Generic CellOps** -- unifies level 1 and 2; mechanical once the 2-cell type exists
5. **Signal/slot executor** -- highest effort but architecturally independent; can develop against the categorical core once 1-4 are solid
6. **Autonomy model** -- layered on top of 2-cells and executor
7. **Morphism persistence** -- extends store.ts pattern; moderate effort
8. **Git integration** -- integration layer; last mile
9. **Type refinement** -- emergent from the above; verify it works, don't build it separately

---

## What tropical tests cover and what new tests are needed

### Migrates from tropical
- Property-based categorical law verification (identity, associativity, interchange, unit)
- Optimizer type preservation and idempotence proofs
- MorphismRegistry register/find/canonical tests

### New test requirements
- Conditional trace: sum-type exit/retry semantics, convergence guarantees
- 2-cell type checker: boundary preservation under factor/fuse/vertical/horizontal composition
- CellOps generic instantiation: same test suite runs at both levels
- Signal/slot executor: firing rules, slot aggregation, concurrent tensor execution, live factoring
- Validator execution: each of the 6 kinds, composed validators, `none` rejection
- Autonomy: escalation triggers, approve gates, human feedback routing
