# anamorphic

Anamorphic is a tool for autonomous code generation through recursive problem decomposition. You give it a software problem in plain English — "build a URL shortener," "implement a rate limiter," "write a CSV processing pipeline" — and it uses Claude to break the problem down into a dependency DAG of implementable subproblems, plans each one with a structured schema (functions, data structures, implementation steps, edge cases), and then generates working code for every leaf node in parallel.

The name has two meanings. In category theory, an anamorphism is a coinductive unfold: you seed a structure and iteratively produce more of it — exactly what happens here, where a single problem node keeps unfolding into children until it reaches something small enough to implement directly. The other meaning is anamorphic projection: taking something and stretching it into a new shape. Both feel right.

The target user is a developer who wants to go from a rough problem statement to a working skeleton faster than they could scaffold it by hand, and who wants that skeleton to reflect a deliberate architectural decomposition rather than a flat dump of code. Anamorphic is not trying to replace a developer — the generated code is a starting point that expects a human to review, test, and iterate on. What it replaces is the tedious work of translating a mental model of a system into file structure, function signatures, and wiring. The interactive UI lets you approve or push back on every decomposition and plan decision before any code is written, so you stay in control of the architecture.

## getting started

```bash
npm install
npm start
```

This builds the project and launches the Electron desktop app. The app opens a browser window at a local port assigned by the OS.

Requires either:
- `ANTHROPIC_API_KEY` set in your environment (uses the Anthropic SDK directly), or
- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` on your PATH) — Claude Code is Anthropic's CLI tool; if you've used it for coding, you likely already have it

**Optional environment variables:**
- `ANAMORPHIC_MODEL` — override the Claude model used at launch (default: `claude-sonnet-4-6`)

To build a distributable package:

```bash
npm run package
```

## how it works

There are three phases. You move through them in order, and the app guides you at each step.

**Traversal phase** — this is where the problem gets broken down. The app works through a queue of nodes, and at each one Claude decides whether the problem is small enough to implement directly (the rough threshold is ~120 lines, single responsibility) or whether it needs to be split into 2–5 subproblems first. You see every proposed split and can approve it, push back, or ask for a different decomposition before anything is locked in. "Leaf nodes" are the ones Claude decided to implement directly — they're what gets turned into code later. You can browse already-resolved parts of the tree while the current node is being evaluated.

**Explore phase** — once the full structure is built you can navigate it, inspect each node's schema (planned functions, data structures, implementation steps, edge cases), and save the whole thing as JSON before proceeding to build. A good place to catch anything that looks wrong before committing to code generation.

**Build phase** — generates the actual code. A scheduler groups leaf nodes into batches whose dependencies are already satisfied and runs each batch in parallel. Two modes:

- **Build** — generates Python modules and writes them to `output/`
- **Build with git** — initializes a local git repo in `output/`, creates a worktree per node, scaffolds a stub commit, then streams the implementation with periodic WIP commits (`wip: N lines` every ~8 seconds) before a final `feat:` commit closes the branch

## UI

The app is an Electron window serving a local web UI over HTTP with Server-Sent Events for real-time updates.

- **Tree sidebar** — full node hierarchy, color-coded by type and build status, clickable to inspect any node (available for browsing even while traversal is in progress)
- **Node detail** — schema, function signatures, implementation steps, edge cases, estimated line count
- **Build view** — live epoch timeline with per-node status, git step (branching / scaffolding / generating / done), branch name, and commit count

The web UI also ships with an embedded demo state so it can be deployed as a static page without a running session.

## architecture

The system is an Electron desktop app. The renderer is a vanilla JS/HTML web UI (`src/web/index.html`) — deliberately no frontend framework, no bundler, zero runtime dependencies on the client side. The main process (`electron/main.ts`) owns the orchestrator, spawns an HTTP server on a port assigned by the OS, and opens a `BrowserWindow` pointed at it.

LLM calls go through the Anthropic SDK (when `ANTHROPIC_API_KEY` is set) or fall back to `claude -p --dangerously-skip-permissions` as a subprocess — meaning Claude Code itself becomes the inference engine for all decomposition, planning, and code generation. The build phase spawns a fleet of Claude Code subprocesses in parallel, one per leaf node, each running in an isolated git worktree.

The web server (`src/lib/webserver.ts`) is a zero-dependency Node `http` server that serves `src/web/index.html` and pushes state via SSE on every orchestrator state change.

## current state

**Solid:** full decomposition loop with approval and refinement; tree browsing during traversal; structured schema generation; topological epoch scheduling; parallel code generation with and without git; real-time web UI; Electron packaging.

**Rougher:** generated code targets Python only; the 120-line cap is a prompt instruction rather than a hard constraint so complex nodes can overrun it; sibling dependency identification is LLM-driven and can miss or hallucinate edges; no retry or recovery path if a node fails during build; cycle detection is silent (cycles get bundled into a final epoch rather than surfaced); the tree lives only in memory, so there is no way to resume an interrupted session without the explicit JSON export from the explore screen.
