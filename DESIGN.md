# Zygomorphic

A graph-structured memory and navigation layer for LLM agent teams.

## Problem

The core deficit of LLMs is their limited context window — a fixed-size working memory that forces a flat, linear interface onto agents reasoning about hierarchical, interconnected information. Current workarounds all lose something:

- **Full-context stuffing** works until the data exceeds the window, then fails completely.
- **RAG / embedding retrieval** flattens structure. You get relevant chunks but lose the relationships between them — the path through the tree matters as much as the leaf.
- **Summarization chains** compress lossy. The agent can't decide what to zoom into because the detail is already gone.

The result: agents either burn tokens reading structure that's mostly irrelevant, or they operate on pre-selected context and can't follow their own judgment about what matters.

## Insight

Trees and graphs are compression. A well-structured hierarchy lets you hold a coarse map in working memory and zoom in on demand. The structure *is* the index. An agent navigating a project graph shouldn't read the whole thing — it should orient at the top, decide which branches are relevant, descend selectively, and stop when it has enough context.

This is how cognition works. You don't load an entire knowledge domain into working memory. You hold a sketch and drill into specifics as needed.

## What Zygomorphic Is

A general-purpose graph memory that LLM agents navigate, read, and write through a small tool interface. It serves two audiences through the same underlying structure:

- **Agents** access it via MCP tools — orient, descend, search, create, restructure.
- **Humans** access it via an Electron app with a bidirectional visual navigator.

The graph persists across conversations and is shared across agent teams. It is the external memory that no single agent's context window can hold.

## Core Concepts

### Nodes

A node is a unit of information at a specific level of abstraction. Every node has:

- **Content** — the actual information (structured or freeform).
- **Summary** — a compressed description sufficient to decide relevance without reading the full content. This is the key optimization: agents prune branches by reading summaries, not by descending.
- **Parent(s)** — what this node is a part of (trees have one parent; graphs may have several).
- **Children** — what this node decomposes into.
- **Links** — cross-references to nodes outside the parent-child hierarchy (dependencies, associations, "see also").

### Summary Propagation

When a node's content or children change, its summary is regenerated. That regeneration propagates upward: a parent's summary reflects its children's summaries. This means the top of the graph always contains a compressed but current view of everything below.

An agent reading level 2 of the graph gets an accurate picture of levels 3–N without descending. This is what makes navigation efficient — you pay tokens proportional to the *breadth of your query*, not the *depth of the tree*.

### Neighborhoods

The fundamental unit of navigation is not a single node but a **neighborhood**: a focal node plus N levels of context in each direction (ancestors and descendants). This mirrors how both the visual UI and the agent API work — you're always looking at a local region of the graph, not the whole thing.

### Shared Exploration State

When multiple agents navigate the same graph, they need coordination:

- Which subtrees have been explored, by whom, and what was found.
- Which nodes are currently being read or written.
- What conclusions were drawn from specific regions.

This is maintained as metadata on the graph itself — exploration state is first-class, not external bookkeeping.

## Agent Interface (MCP)

The MCP server exposes a small, composable tool surface:

| Tool | Purpose |
|---|---|
| `get_overview()` | Top-level summary — the entire graph compressed to one context-window's worth of orientation. |
| `get_node(id)` | Full content and metadata for a specific node. |
| `list_children(id)` | One level of children with their summaries. The primary navigation primitive. |
| `get_neighborhood(id, depth)` | Focal node + N levels of ancestors and descendants with summaries. The "screenful" operation. |
| `search(query, scope?)` | Keyword or semantic search, optionally scoped to a subtree. |
| `create_node(parent_id, content)` | Add a new node. Summary is generated automatically. |
| `update_node(id, content)` | Modify a node. Triggers summary regeneration upward. |
| `link_nodes(from, to, relation)` | Create a cross-reference between nodes outside the hierarchy. |
| `restructure(id, new_parent)` | Move a subtree. Summaries propagate to both old and new ancestors. |
| `get_exploration_state()` | What has been visited, by whom, what was concluded. |

This is the full surface. Every agent operation is a composition of these primitives.

### Navigation Pattern

A typical agent interaction:

1. `get_overview()` — orient. Read the top-level summary.
2. `list_children(interesting_branch)` — descend one level. Read summaries to decide next move.
3. `list_children(deeper)` — descend again based on relevance.
4. `get_node(target)` — read full content of the specific node needed.
5. `create_node(...)` or `update_node(...)` — write findings back into the graph.

Total tokens spent: summaries at 2–3 levels + one full node. Not the entire graph.

## Visual Interface

### Bidirectional Miller Columns

The Electron app renders the graph as horizontally-scrolling columns centered on a focal node:

```
← ancestors            focal node            descendants →

┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
│ grandparent│  │  parent A  │  │            │  │  child 1   │
│            │← │  parent B  │← │  ● FOCUS   │→ │  child 2   │
│            │  │            │  │            │  │  child 3   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘
```

- **Focus shift**: click any node and it becomes the center. Everything re-flows.
- **Multiple parents**: a node with several parents shows multiple incoming edges from the left column — convergence is visible.
- **Cross-links**: edges that skip levels or connect across branches render as arcs over the columns, like a subway map overlay.
- **Ghost nodes**: when a node appears in multiple paths, aliases show in-place with a visual indicator. Click to re-center and reveal the other path.
- **Depth fade**: columns further from focus are visually de-emphasized. The viewport *is* the context window.

The visual representation and the agent's MCP neighborhood are the same abstraction. What the human sees is what the agent "sees."

## Scaffolding (from Anamorphic)

Zygomorphic is forked from [Anamorphic](https://github.com/...), a code generation tool that decomposes problems into navigable trees. The following components carry over directly:

| Component | Anamorphic | Zygomorphic adaptation |
|---|---|---|
| **State machine** (`state.ts`) | Pure reducer, all mutations through events | Same pattern. Add events for agent writes, link creation, restructuring. |
| **Tree data model** (`types.ts`) | `NodeData` with parent/children/dependencies | Generalize: remove code-specific fields (`LeafSchema`, `FunctionDef`). Add `summary`, `links`, `exploration_state`. Content becomes generic. |
| **Orchestrator** (`orchestrator.ts`) | Coordinates LLM calls, emits state events | Becomes the graph mutation coordinator. Handles summary propagation on writes. |
| **Scheduler** (`scheduler.ts`) | Topological sort for parallel execution | Reusable for coordinating multi-agent exploration of dependent subtrees. |
| **Web server** (`webserver.ts`) | HTTP + SSE for real-time state push | Add MCP transport (stdio or SSE) alongside existing HTTP/SSE. |
| **Electron shell** (`electron/main.ts`) | BrowserWindow loading web UI | Same. Replace sidebar tree view with bidirectional Miller columns. |
| **Web UI** (`index.html`) | Vanilla JS, single-file, sidebar tree | Rewrite the rendering layer for Miller columns. Keep the vanilla approach. |

What's **removed**: LLM-driven decomposition loop, code generation, build pipeline, Python-specific schemas.

What's **added**: MCP server, generic node schema, summary propagation, cross-links, exploration state, agent write path, persistence layer.

## Persistence

Anamorphic stores everything in memory with optional JSON export. Zygomorphic needs durable storage since the graph persists across conversations and agent sessions.

Starting point: JSON file with write-on-mutation. The graph is a single serializable object; atomic writes via temp-file-and-rename are sufficient for single-machine use. If concurrent agent writes become a bottleneck, move to SQLite.

## Design Principles

1. **Navigation, not retrieval.** Agents orient themselves in the graph and decide where to look. They are not handed pre-selected context.

2. **Summaries are the primary optimization.** An agent should be able to decide whether a subtree is relevant by reading a one-paragraph summary, not by descending into it.

3. **Read and write.** The graph is not static. Agents restructure it, add nodes, update summaries, link related regions. It evolves as understanding deepens.

4. **Same structure, two interfaces.** Humans and agents navigate the same graph. The visual layout and the MCP neighborhood are the same abstraction at different rendering layers.

5. **Small tool surface.** Ten tools, composable. No domain-specific operations baked into the API. The graph is general-purpose; domain specificity lives in how agents use it.

6. **Tokens proportional to relevance.** An agent working on a high-level decision reads top-level summaries. An agent debugging a specific detail drills deep into one branch. Same graph, different token cost, no waste.
