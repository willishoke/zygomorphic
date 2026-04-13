# Zygomorphic: Architecture

## The Problem

A flat plan imposes linear, sequential structure where none exists.

Most project work is not inherently sequential. Tasks have complex dependency relationships — some block others, many are fully independent, some share typed interfaces. But a flat plan (a numbered list, a backlog, a feature roadmap) has no way to express this structure. Without a formal dependency model, work defaults to sequential execution even when large portions are orthogonal and could run concurrently.

The human becomes the dependency analysis bottleneck. They manually determine what blocks what, what's safe to parallelize, what can be delegated wholesale. This consumes exactly the mental resources that should go toward architectural judgment — and it's error-prone, because the dependency relationships are implicit, informal, and constantly changing as the work evolves.

Worse: there's no way to ask "is this plan complete?" as a mechanical question. Completeness of a flat plan is a judgment call. A plan that says "add matrix types" but doesn't account for an affected layer upstream looks complete — it IS complete relative to what the planner attended to. You discover the gap after work is done, or never.

## What Zygomorphic Does

Plan incompleteness becomes a type error. Parallelizability becomes a structural property.

Every morphism (agent operation) has a typed domain and codomain. Every wire in the plan graph connects a producer's codomain to a consumer's domain. A dangling wire — a type that appears in a domain with no producing morphism upstream — is a structural gap. The type checker catches it mechanically, regardless of whether the planning model "thought about" the affected region. The plan cannot be marked complete while wires dangle.

For parallelization: morphisms with no dependency edge between them are tensorable (can execute concurrently). Topological sort derives compose vs tensor from declared dependencies. The human's job shifts from scheduling logistics to architectural judgment.

---

## 1. Categorical Foundation

The execution engine is a free traced symmetric monoidal category.

### Objects (0-cells): Types

Executable validators — predicates that check artifacts:

```typescript
interface ArtifactType {
  name: string;
  validator: ValidatorSpec;
}

type ValidatorSpec =
  | { kind: 'command'; command: string; args: string[]; expectedExit: number }
  | { kind: 'schema'; schema: JSONSchema }
  | { kind: 'tensor'; checks: ValidatorSpec[] }       // parallel independent checks
  | { kind: 'sequence'; steps: ValidatorSpec[] }      // sequential dependent checks
  | { kind: 'human'; prompt: string }                 // requires human judgment
  | { kind: 'none' }                                  // unvalidatable → must factor
```

Types are not abstract labels. `CompilingTypeScript<I>` = `is_valid_syntax('ts') ⊗ exports_interface(I) ; passes_tests(smoke)`. The validator IS the type.

Composition validity is subtyping: `cod(f) <: dom(g)` — "f's output satisfies g's input validator." A richer artifact passes a weaker validator. No explicit projection needed.

### Morphisms (1-cells): Terms

Five constructors:

```typescript
type Term =
  | { tag: 'id'; portType: ArtifactType }
  | { tag: 'morphism'; name: string; dom: ArtifactType; cod: ArtifactType;
      body: MorphismBody; autonomy: Autonomy }
  | { tag: 'compose'; first: Term; second: Term }
  | { tag: 'tensor'; left: Term; right: Term }
  | { tag: 'trace'; stateType: ArtifactType; init: Artifact | null; body: Term }

type MorphismBody =
  | { kind: 'agent'; prompt: string; model?: string }
  | { kind: 'tool'; command: string; args: string[] }
  | { kind: 'human'; description: string }
  | { kind: 'plan'; description: string }             // factoring agent

type Autonomy = 'auto' | 'approve' | 'manual';
```

### Composition Rules

- `compose(f: A→B, g: B→C)` requires `cod(f) <: dom(g)`
- `tensor(f: A→B, g: C→D)` produces `f⊗g: A⊗C → B⊗D` (causal independence)
- `trace(S, init, body: A⊗S → B+S)` produces `A → B` (feedback encapsulated)

### The Conditional Trace

Body has sum type codomain: `A ⊗ S → Output + S`. Left injection exits. Right injection feeds back with error context. The trace only emits through the `Output` path — the output type is a **guarantee**, not a probability. This domesticates LLM nondeterminism.

### Optimizer Laws

Identity elimination, compose/tensor flattening, interchange law. Iterated to fixed point. Ported from tropical's `compiler/optimizer.ts`.

---

## 2. Factor and Fuse

Every mutation of the execution graph is expressible as a sequence of two operations:

- **Factor:** `f: A→B` is replaced by `h: A→M, g: M→B` where `f = g ∘ h`. Introduces intermediate type M and two new morphisms. The 2-cell `α: f ⟹ g ∘ h` records the factoring.
- **Fuse:** Inverse. `g ∘ h` collapses back to `f`. The inverse 2-cell `α⁻¹` records the undo.

Type introduction is atomic with factoring — the `intermediateType` field in the 2-cell introduces M simultaneously with the new morphisms. No separate "type creation" operation exists.

### Completeness

All graph mutations decompose into factor/fuse sequences:

| Mutation | Decomposition |
|---|---|
| Decompose task | Factor |
| Undo decomposition | Fuse |
| Re-decompose | Fuse + Factor (with new M') |
| Retype a boundary | Fuse + Factor (introduces M') |
| Parallelize | Factor into tensor (f ⟹ g ⊗ h) |

### Two Kinds of Type Introduction

- **Compositional:** New type defined as composition of existing kernel primitives. Safe by construction.
- **Primitive extension:** New opaque executable validator. Axiom extension, taken on faith. Defaults to `approve` autonomy.

---

## 3. The 2-Category

Factoring IS a 2-morphism. This structure is already present — naming it buys typed factoring, typed rewind, and typed planning traces.

| Level | Name | What | Examples |
|---|---|---|---|
| 0-cells | Objects | Types | `Spec`, `ValidCode` |
| 1-cells | Morphisms | Operations | `f: Spec → ValidCode` |
| 2-cells | Rewrites | Factorings | `α: f ⟹ g ∘ h` |

2-cell composition:
- **Vertical:** factor, then factor a child = composite factoring
- **Horizontal:** factor parallel branches independently = `α ⊗ β`
- **Identity:** leave a morphism unchanged

The 2-cell type checker verifies: `dom(source) = dom(target)` and `cod(source) = cod(target)`. Factoring preserves boundary types.

Rewind = inverse 2-cell. Rewindability is typed — the system guarantees every factoring is undoable.

---

## 4. The Generic Categorical Toolkit

The 2-cell structure is not a second implementation. It's the same implementation, instantiated again.

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

Instantiation:

| | Level 1 (execution) | Level 2 (planning) |
|---|---|---|
| Obj | ArtifactType | Term |
| Cell | Term | Rewrite |
| source | dom(term) | original morphism |
| target | cod(term) | factored composition |
| validate | run validator on artifact | check type alignment |
| execute | call LLM / run tool | invoke planning agent |
| trace | retry until valid output | retry until valid factoring |

The type checker, optimizer, and composition logic are written once. Each level instantiates the same code. The "no meta-level" principle is mechanically enforced: planning and execution use the same functions with different type parameters.

The trace at level N handles "try, fail, retry" at that level — no N+1 cells needed. Traces are the regress-stopper.

---

## 5. Execution Model: Signal/Slot

Signal/slot is the natural operational semantics of the categorical model, not a choice among alternatives.

A morphism in a traced symmetric monoidal category has no global awareness. It knows its input types and output types. It fires when inputs are present. That IS a signal/slot node. The categorical structure and the execution model are the same thing at different abstraction levels.

**Design principle:** No component has global graph visibility. The dependency structure is encoded in the wiring. Any coordinator with global visibility reintroduces the flat-planner cognitive load the system eliminates. Locality is load-bearing — a morphism's correctness depends only on its typed boundary, its execution depends only on its input slots.

### Mechanics

- Each output wire is a signal; each input wire is a slot
- Node fires when all slots are filled
- No global barrier, no epochs — maximal async parallelism
- Topological sort derives tensor/compose from declared dependencies
- Critical path emerges from signal propagation

### Tensor Semantics

`f ⊗ g` means causal independence — no data dependency between branches. NOT simultaneity. Independence is ENFORCED by workspace isolation: tensor decomposition → parallel git branches. Branches share no mutable state. A merge conflict between tensor branches is a type error surfaced late.

### Dynamic Graph Mutation

Lock-free. Factoring at runtime is append-only: create nodes, wire them, set forwarding pointer from original output slot to new subgraph's terminal, enqueue. Existing concurrent nodes never read new structure. Rewind is localized cancellation owned by the trace that created the region.

---

## 6. Validation as Physics

### Planning-Time Type Checking (Primary)

The validator kernel matters most at PLANNING time. When the type checker verifies `cod(f) <: dom(g)` for every composition, it's checking that the plan has no structural gaps. Every output has a consumer, every input has a producer, no dangling wires. Plan incompleteness = type error.

### Execution-Time Validation (Secondary)

At execution time, validators check artifacts against types. The conditional trace handles failures: retry with feedback until the artifact satisfies the validator.

### Validation Impossibility Drives Factoring

A morphism whose codomain has `validator: { kind: 'none' }` CANNOT execute — it must factor. The tree grows downward until every leaf has a constructible validator. The frontier of unfactored morphisms IS the set of morphisms with unvalidatable codomains.

Two failure modes, two mechanisms:
- "I tried and failed the check" → trace iterates (local)
- "There is no check" → must factor (structural)

### Type Refinement (The Ratchet)

Types start weak, get refined through failure:
```
Attempt 1: Spec → Code                           (too loose)
Attempt 2: Spec → CompilingCode                   (tighter)
Attempt 3: Spec ⊗ APIConstraints → CompilingCode<I>   (learned from failure)
```

Types are cumulative learning. Each failure tightens the validator. Type bloat signals wrong factoring — pressure toward better decomposition.

### Bootstrap Kernel

Primitive validators that exist before the system runs:
- `is_valid_json(schema)` — parse + schema check
- `is_valid_syntax(language)` — call language parser
- `passes_tests(suite)` — run test harness
- `matches_regex(pattern)` — string validation
- `human_review(prompt)` — human-in-the-loop

These are axioms. Composed validators (tensor/sequence of primitives) are theorems.

---

## 7. Autonomy Model

Annotation on the factoring 2-cell:

- **auto:** agent factors and proceeds
- **approve:** agent proposes, human reviews
- **manual:** human draws the split

Human feedback type:
```
human_review: Proposal → Approved(Factoring)
                        + Rejected(Reason)
                        + Edited(ModifiedFactoring)
                        + Restructured(AlternativeFactoring)
```

Escalation: an agent in `auto` whose trace isn't converging promotes itself to `approve`. Autonomy is a floor, not a ceiling.

No inter-agent communication. Typed boundaries are the complete interface contract. Agents are scoped: input type, output type, nothing else.

---

## 8. Persistence and Version Control

Markdown-as-truth + derived index (extending existing `src/lib/store.ts` pattern):

| Layer | Format | Version controlled |
|---|---|---|
| Morphism definitions | Markdown + frontmatter in `.zygomorphic/plan/` | Yes |
| Type schemas | JSON/markdown | Yes |
| Dependency graph | Derived (SQLite) | No — rebuilt from morphisms |
| Execution state | In-memory | No — ephemeral |
| Factoring history | `git log` of morphism files | Yes |

### Morphism File Format

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

### Git Integration

- Tensor decomposition → parallel branches (enforces causal isolation)
- Typed boundary validation → CI checks on PRs
- Composition (sequential work) → merge PR
- `git log --follow .zygomorphic/plan/` = factoring history

---

## 9. Atoms

The system bottoms out at three genuinely atomic operations:

- `prompt_agent: TaskDescription → RawOutput` — agent produces text. Always succeeds.
- `validate: RawOutput → ValidOutput + Error` — pure check. Always succeeds.
- `format_error: Error → TaskDescription` — pure transform. Always succeeds.

Everything above is composition. The retry loop for "produce valid code":

```
trace(Error, null,
  compose(prompt_agent, validate)
  with feedback: format_error
)
```

Each piece is atomic. Structure provides retry. The output type is guaranteed by the trace's exit condition.

---

## 10. Architectural Decisions as Factoring Decisions

An architectural decision IS a choice of intermediate type M. "JIT vs interpreter" = two different factorings of the same morphism. "Compiler in C++ vs TypeScript" = where the seam falls.

Counterfactuals live in morphism decision logs. Not just the path taken, but paths rejected and why. Context travels with structure. Prevents relitigating settled questions.

---

## 11. What Transfers from Tropical

| Component | Transfers as |
|---|---|
| `Term` constructors | Verbatim (id, morphism, compose, tensor, trace) |
| `inferType()` | Generic `typeCheck<Obj, Cell>` |
| `optimize()` | Generic `optimize<Obj, Cell>` |
| `MorphismRegistry` | Coercion auto-insertion at boundaries |
| `buildDependencyGraph()` | Subtask dependency analysis |
| `topologicalSort()` | Tensor/compose derivation |

Does NOT transfer: DSP expression trees, JIT engine, audio-specific types, epoch-based execution.

New: validator framework, signal/slot executor, autonomy model, morphism persistence, git integration, conditional trace pattern.

---

## Open Questions

1. **Combinators:** Are named factoring shorthands (generate, fold, chain) worth including as sugar over tensor/compose, or should factoring agents discover parallel structure dynamically? Likely: thin sugar, deferred to after core is proven.

2. **Type bundling:** When tensor products grow unwieldy (`a ⊗ b ⊗ c ⊗ d`), who bundles them into named types? Agent-driven at `auto`, human-named at `approve`. Mechanism: introducing a named type alias IS a factor 2-cell.

3. **Parent persistence vs mitosis:** Whether factored morphisms persist as ancestors (tree structure, easy rewind, context navigation) or are erased (flat graph, free restructuring, cross-cutting refactoring unconstrained). Current leaning: mitosis (erasure) with 2-cell history as the record. The 2-cell log (git history of morphism files) preserves context without imposing tree structure. Rewind reconstructs from 2-cell records.
