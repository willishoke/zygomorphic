# zygomorphic

Zygomorphic is a persistent graph memory for AI agents and humans. Agents explore, annotate, and build structure in a shared knowledge graph backed by PostgreSQL. Humans see every change in real time through a two-pane carousel UI. Comments, exploration logs, and labeled edges create a live collaborative workspace where agents and humans reason about the same evolving structure — together.

The name comes from biology: zygomorphic symmetry is bilateral symmetry, the kind you see in orchids and snapdragons. One axis of reflection, two complementary halves. That's the system — agents on one side, humans on the other, working the same graph.

## getting started

```bash
# start postgres (if not already running)
brew services start postgresql@18   # macOS
# or: sudo systemctl start postgresql  # Linux

# create the database
createdb zygomorphic

npm install
npm start
```

This builds the project, initializes the schema, and launches the Electron app with a live connection to Postgres. The UI opens at `http://localhost:7777`.

**Required:**
- PostgreSQL 15+ running locally
- Node.js 22+

**Environment variables:**
- `ZYGOMORPHIC_DB_URL` — Postgres connection string (default: `postgresql://<your-user>@localhost/zygomorphic`)
- `ANTHROPIC_API_KEY` — for LLM-powered agent features

## how it works

Zygomorphic is an **undirected labeled graph** stored in PostgreSQL. Every node has content, a summary, and an exploration log. Nodes are connected by labeled edges — `contains`, `depends_on`, `related`, `contradicts`, whatever makes sense. There is no hierarchy, no root, no depth limit. Cycles are fine. The graph is the structure, and the structure emerges from use.

**Agents** interact through 12 MCP tools: they can read the graph, search it, create and connect nodes, leave comments, and record what they've explored. Multiple agents can work the same graph concurrently.

**Humans** interact through the web UI — a two-pane carousel where the left pane shows the focused node (content, exploration history, comments) and the right pane lists all its edges. Click an edge and the view slides over with a CSS-animated transition. Navigation history gives you a back button. Comments are first-class: type one in the UI and it shows up for agents on their next read.

**State flows in real time.** The orchestrator persists every mutation to Postgres and pushes the full state to all connected clients via Server-Sent Events. Agent writes appear in the UI instantly. Human comments appear in agent tool responses instantly.

## MCP tools

Agents connect via the [Model Context Protocol](https://modelcontextprotocol.io). The server exposes:

| Tool | Description |
|------|-------------|
| `get_overview` | All nodes with summaries |
| `get_node` | Full content, edges, and exploration for a node |
| `get_neighborhood` | BFS traversal to depth N from any node |
| `search` | Keyword search across content and summaries |
| `create_node` | Create a node, optionally connected to another |
| `update_node` | Update content and summary |
| `create_edge` | Connect two nodes with a labeled edge |
| `delete_edge` | Remove an edge |
| `add_comment` | Leave an ephemeral comment on a node |
| `record_exploration` | Log that an agent visited a node |
| `get_exploration_state` | What's been visited, by whom, and what was concluded |

## architecture

- **Database**: PostgreSQL with indexed tables for nodes, edges, and comments. CASCADE deletes keep referential integrity tight. Neighborhood queries use JOINs, not application-level traversal.
- **Backend**: Node.js orchestrator with a pure-function reducer for state transitions and async Postgres persistence. Zero-dependency HTTP server pushes state via SSE.
- **Frontend**: Vanilla JS/HTML — no framework, no bundler, no runtime dependencies. The carousel animation is pure CSS transforms.
- **MCP**: Standard stdio transport. Agents get the full tool suite; read tools query Postgres directly, write tools dispatch through the orchestrator.
- **Electron**: Desktop shell that wires everything together. But the web server is the real interface — Electron is optional packaging, not a requirement.

## where this is going

Zygomorphic is being built for web deployment at scale. The architecture is PostgreSQL-native from day one — not a local-first app with a sync layer bolted on, but a database-backed system designed to handle thousands of nodes, dozens of concurrent agents, and persistent storage measured in years.

Here's what's coming:

**Comment threading** — Comments gain a `parent_comment_id` field, turning flat annotation into threaded discussion. Agents and humans can reply to each other's comments, building context directly on the nodes that need it.

**Comment-as-task** — Comments become actionable. An `addressee` field and `@mention` syntax let humans assign work to specific agents (or vice versa). A comment that says `@researcher find contradicting evidence for this claim` isn't just a note — it's a task with a clear owner.

**Agent reactor** — A polling loop that watches for unresolved `@mentions` and invokes the appropriate agent to handle them. The graph becomes self-organizing: humans leave instructions, agents execute them, results flow back as new nodes and comments. No manual orchestration required.

**Private subgraphs** — Nodes gain `visibility` and `owner` fields, enabling access control at the node level. Agents can maintain private working state that doesn't pollute the shared graph until they're ready to publish. Teams can partition a single graph into public and private regions.

## current state

Solid: undirected graph model with full CRUD, PostgreSQL persistence with schema migrations, 12 MCP tools for agent interaction, real-time SSE state push, carousel UI with animated navigation, ephemeral comments with time-based expiry, exploration logging, CI with Postgres service containers.

In progress: web deployment (the HTTP server already works standalone — Electron is just a shell), multi-user support, expanded agent tooling.
