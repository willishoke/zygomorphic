import {
  getPool, initSchema, closePool,
  insertNode, insertEdge,
} from '../src/lib/db.js';

const now = new Date().toISOString();
let counter = 0;
function id(prefix: string) {
  return `${prefix}_${Date.now()}_${counter++}`;
}

const nodes: Array<{ key: string; id: string; content: string; summary: string }> = [
  {
    key: 'zygomorphic',
    id: id('zygomorphic'),
    summary: 'Shared knowledge graph for humans and AI agents',
    content: `Zygomorphic is a persistent graph-based memory system where humans and LLM agents collaborate in a shared knowledge graph. Nodes hold free-form content; edges are undirected labeled relationships. Both humans (via a web UI) and agents (via MCP tools) read and write the same structure. The name reflects bilateral symmetry: one interface for humans, one for agents, both operating on the same underlying graph.`,
  },
  {
    key: 'design_philosophy',
    id: id('design'),
    summary: 'Core design principles guiding the system',
    content: `Six principles shape every decision in Zygomorphic:
1. Navigation over retrieval — agents orient themselves in the graph rather than receiving pre-selected context.
2. Summaries as optimization — read summaries to decide relevance before loading full content; token cost scales with query breadth, not depth.
3. Read and write — the graph is live; agents can create, update, and restructure nodes.
4. Same structure, two interfaces — humans and agents share one graph, rendered differently.
5. Small composable tool surface — ~12 MCP tools, no domain-specific operations.
6. Token efficiency — high-level orientation uses summaries; deep investigation drills one branch.`,
  },
  {
    key: 'graph_data_model',
    id: id('model'),
    summary: 'GraphData: nodes and edges as the core data shape',
    content: `GraphData is the central in-memory shape: { nodes: Record<string, NodeData>, edges: Record<string, Edge> }. It represents the full graph at a point in time. Loaded from Postgres on startup and on change notifications. Passed to the MCP server so tools can read it without extra DB queries.`,
  },
  {
    key: 'node_structure',
    id: id('node'),
    summary: 'NodeData: id, content, summary, exploration, timestamps',
    content: `Each node carries: id (string), content (free-form text), summary (short compressed description), exploration (array of ExplorationEntry recording agent visits), created_at and updated_at (ISO timestamps). Summaries are written by the creator or auto-truncated from content. Exploration entries accumulate over time; they are never overwritten.`,
  },
  {
    key: 'edge_structure',
    id: id('edge'),
    summary: 'Edge: undirected labeled connection between two nodes',
    content: `Edges are undirected: { id, a, b, label, created_at }. The label carries the semantic (e.g. "contains", "depends_on", "contradicts", "see_also"). Because edges are undirected, both nodes appear as neighbors regardless of which was listed first. Direction is inferred from label semantics, not structure. This simplifies navigation and supports multi-parent relationships naturally.`,
  },
  {
    key: 'exploration_metadata',
    id: id('exploration'),
    summary: 'ExplorationEntry: tracks which agents visited a node and what they concluded',
    content: `ExplorationEntry: { agent: string, timestamp: number, conclusion?: string }. Stored as a JSONB array on the node row. Agents append entries via record_exploration(); entries are never deleted. get_exploration_state() returns all nodes with exploration history, grouped by agent and conclusion. This gives both humans and agents visibility into what has been investigated and what was found.`,
  },
  {
    key: 'comment_system',
    id: id('comment'),
    summary: 'Ephemeral annotations on nodes with voting and soft delete',
    content: `Comments are node-scoped annotations: { id, node_id, content, author, created_at, updated_at, expires_at, deleted_at, score }. Features: optional expiry (auto-cleaned by a 5-minute timer), soft delete (deleted_at flag, row preserved), voting via comment_votes table (±1 per author), edit history (updated_at). Author validation: humans can edit/delete any comment; agents can only modify their own. Comments are loaded into AppState.focalComments on focus change.`,
  },
  {
    key: 'db_layer',
    id: id('db'),
    summary: 'db.ts: PostgreSQL persistence via pg.Pool',
    content: `src/lib/db.ts owns all database interactions. Uses pg.Pool with connection string from ZYGOMORPHIC_DB_URL (default: postgresql://rhizome@localhost/zygomorphic). Exports: getPool(), initSchema(), closePool(), loadFullGraph(), getNode(), insertNode(), updateNode(), deleteNode(), insertEdge(), deleteEdge(), getComments(), insertComment(), softDeleteComment(), editComment(), upsertVote(), searchNodes(), getNeighborhood(), getActivityFeed(), getStats(), deleteExpiredComments(), startListening().`,
  },
  {
    key: 'db_schema',
    id: id('schema'),
    summary: 'Four tables: nodes, edges, comments, comment_votes',
    content: `Tables:
- nodes(id PK, content TEXT, summary TEXT, exploration JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
- edges(id PK, node_a TEXT FK→nodes, node_b TEXT FK→nodes, label TEXT, created_at TIMESTAMPTZ)
- comments(id PK, node_id FK→nodes, content TEXT, author TEXT, created_at/updated_at/expires_at/deleted_at TIMESTAMPTZ, score INT)
- comment_votes(comment_id FK, author TEXT, vote SMALLINT, PRIMARY KEY(comment_id, author))

Indexes on edges.node_a/b, comments.node_id and expires_at, votes.comment_id. Cascade deletes: removing a node drops its edges and comments automatically.`,
  },
  {
    key: 'db_search',
    id: id('search'),
    summary: 'searchNodes(): case-insensitive ILIKE on content and summary',
    content: `searchNodes(query) runs: SELECT * FROM nodes WHERE content ILIKE $1 OR summary ILIKE $1 LIMIT 50. The query term is wrapped in % wildcards. Results are returned as NodeData objects. Limit of 50 prevents runaway results. Used by the MCP search tool and could be extended to full-text search (tsvector) for better ranking.`,
  },
  {
    key: 'db_neighborhood',
    id: id('neighborhood'),
    summary: 'getNeighborhood(): focal node + direct neighbors + connecting edges',
    content: `getNeighborhood(id) returns { node: NodeData | null, edges: Edge[], neighbors: Record<string, NodeData> }. Fetches the focal node, then all edges where node_a = id OR node_b = id, then loads all unique neighbor nodes. Returns empty result (node: null, edges: [], neighbors: {}) for unknown IDs. Used by the MCP get_neighborhood tool for BFS traversal.`,
  },
  {
    key: 'db_realtime',
    id: id('realtime_db'),
    summary: 'LISTEN/NOTIFY: Postgres pushes change notifications to the server',
    content: `startListening(onGraph, onComments) opens a dedicated pg.Client (not from the pool) and LISTENs on two channels: "zygomorphic_changes" with payload "graph" or "comments". A NOTIFY trigger fires after INSERT/UPDATE/DELETE on nodes, edges, and comments. Notifications are debounced 200ms. On connection loss, retries every 3 seconds. Returns a cleanup function. This eliminates polling and gives sub-second UI updates.`,
  },
  {
    key: 'state_machine',
    id: id('state'),
    summary: 'state.ts: pure AppState + reduce(state, event) -> state',
    content: `AppState shape: { screen: AppScreen, loading: boolean, error?: string, graph: GraphData | null, focusNodeId: string | null, focalComments: Comment[], navigationHistory: string[] }. The reduce() function is a pure switch over AppEvent — no side effects, fully unit-testable. All state transitions are expressed as events dispatched through this function. See reducer.test.ts for exhaustive coverage.`,
  },
  {
    key: 'app_events',
    id: id('events'),
    summary: 'AppEvent union: all possible state transitions',
    content: `AppEvent is an exhaustive discriminated union:
- GRAPH_LOADED: replace entire graph
- NODE_CREATED, NODE_UPDATED, NODE_DELETED: CRUD on nodes
- EDGE_CREATED, EDGE_DELETED: CRUD on edges
- COMMENTS_LOADED, COMMENT_ADDED: comment management
- EXPLORATION_UPDATED: append exploration entry
- NAVIGATION_PUSH, NAVIGATION_BACK, FOCUS_CHANGED: navigation
- ERROR: set error message, clear loading

Each event carries only the data needed for its transition. The reducer handles edge cases (missing nodes, duplicate history entries, etc.) gracefully.`,
  },
  {
    key: 'orchestrator',
    id: id('orch'),
    summary: 'orchestrator.ts: wires state, DB, and SSE broadcast together',
    content: `Orchestrator extends EventEmitter. Holds current AppState. dispatch(event) pipeline: (1) apply reduce(), (2) persist mutation to Postgres, (3) auto-load comments when focus changes, (4) emit "state" for SSE broadcast. Also exposes reload() (full graph reload), reloadComments(), deleteComment(), editComment(), voteComment(). The persist() method maps events to DB calls — only mutating events write to DB; read events (FOCUS_CHANGED, NAVIGATION_*) do not.`,
  },
  {
    key: 'mcp_server',
    id: id('mcp'),
    summary: 'mcp.ts: MCP protocol server exposing graph tools to LLM agents',
    content: `src/lib/mcp.ts creates an @modelcontextprotocol/sdk Server. The current graph and dispatch function are injected via setGraph() and setDispatch(). ID generation is time-based with a monotonic counter (format: prefix_timestamp_counter). Tools return MCP content blocks — text for success, isError:true for failures. The server can be connected to stdio transport (for Claude Code / MCP clients) via startStdioServer().`,
  },
  {
    key: 'mcp_read_tools',
    id: id('mcp_read'),
    summary: 'MCP read tools: get_overview, get_node, get_neighborhood, search',
    content: `Four read-only tools:
- get_overview(): node count, edge count, all node IDs + summaries
- get_node(id): full content, all edges (with neighbor summaries), exploration history
- get_neighborhood(id, depth=2): BFS from focal node up to depth 10; shows each neighbor's summary and connecting edges
- search(query): case-insensitive keyword search on content and summary; returns matches with location (content vs summary)

All tools return formatted markdown text blocks.`,
  },
  {
    key: 'mcp_write_tools',
    id: id('mcp_write'),
    summary: 'MCP write tools: create_node, update_node, create_edge, delete_edge',
    content: `Four mutation tools:
- create_node(content, summary?, connect_to?, edge_label?): creates node, optionally creates edge to existing node; summary auto-truncated to 120 chars from content if omitted
- update_node(id, content, summary?): modifies existing node; returns error for unknown id
- create_edge(a, b, label): creates undirected edge; errors if either node missing
- delete_edge(edge_id): removes edge by id; errors if edge not found

All write tools dispatch events via the injected dispatch function.`,
  },
  {
    key: 'mcp_exploration_tools',
    id: id('mcp_explore'),
    summary: 'MCP exploration tools: record_exploration, get_exploration_state',
    content: `Two exploration tools:
- record_exploration(id, agent, conclusion?): appends an ExplorationEntry to the node; errors if node not found
- get_exploration_state(): returns all nodes that have been explored, grouped by node, showing agent name, timestamp, and conclusion for each entry; returns "No exploration recorded" if graph has none

These tools give agents visibility into collaborative investigation history.`,
  },
  {
    key: 'web_server',
    id: id('webserver'),
    summary: 'webserver.ts: HTTP/SSE server bridging the orchestrator and the browser',
    content: `createWebServer(orchestrator, port) starts an http.Server. Endpoints: GET /events (SSE state stream), GET /state (JSON snapshot), GET /activity?sort=recent|score (activity feed), GET /stats (aggregate stats), POST /action (dispatch user actions), GET / (serves index.html). Open CORS. Maintains a list of connected SSE clients; broadcasts on every orchestrator "state" event. All action types: navigate, focus, navigate_back, refresh, refresh_comments, delete_comment, edit_comment, vote_comment, add_comment.`,
  },
  {
    key: 'sse_endpoint',
    id: id('sse'),
    summary: 'GET /events: Server-Sent Events for real-time state push to the browser',
    content: `GET /events upgrades the connection to SSE (Content-Type: text/event-stream). On connect, immediately sends the current state as a "state" event. All subsequent orchestrator state emissions are broadcast as "data: <JSON>\n\n". Clients auto-reconnect on disconnect (2-second retry in the web UI). This is the primary channel for the UI to stay synchronized with the server and database.`,
  },
  {
    key: 'action_endpoint',
    id: id('action'),
    summary: 'POST /action: dispatches user actions from the browser to the orchestrator',
    content: `POST /action accepts JSON body with a "type" field. Supported types: navigate (focus + push history), focus (focus only), navigate_back (pop history), refresh (full graph reload), refresh_comments (reload focal node's comments), add_comment, delete_comment, edit_comment, vote_comment. Returns 204 on success. The orchestrator handles persistence and state update; the SSE broadcast delivers the result back to all clients.`,
  },
  {
    key: 'web_ui',
    id: id('ui'),
    summary: 'src/web/index.html: single-file vanilla HTML/CSS/JS client',
    content: `The entire web client is one file: no framework, no bundler, no runtime dependencies. ~840 lines of HTML, CSS, and JavaScript. State arrives via SSE (global state variable). User interactions POST to /action. Three view modes: Graph (default), Activity, Stats. CSS uses GitHub dark theme palette via variables. Monospace font throughout. View transitions animated. Helpers: relative time formatting, HTML escaping, edge-label color mapping.`,
  },
  {
    key: 'graph_view',
    id: id('graph_view'),
    summary: 'Two-pane graph view: focal node on left, edges on right',
    content: `The graph view shows two panes side by side. Left pane (focal): node ID, summary, full content in monospace pre block, exploration log, link filter chips (one per unique edge label). Right pane (edges): all edges grouped by label; each shows label, neighbor ID, neighbor summary; clicking navigates. Back button pops navigationHistory. Link filter chips narrow the right pane to edges of a specific relation type; clicking again clears the filter.`,
  },
  {
    key: 'activity_stats_view',
    id: id('activity'),
    summary: 'Activity feed and stats: secondary views for discovery and analytics',
    content: `Activity view: fetches GET /activity?sort=recent|score. Shows interleaved nodes and comments as cards. Node cards show degree and last-updated time. Comment cards show author, score, parent node summary, and creation time. Sortable by recent (timestamp) or top (score). Filterable by kind (all, nodes, comments).

Stats view: fetches GET /stats. Shows summary cards (node count, edge count, comment count), top-connected nodes (by degree), top-commented nodes (by comment count), and edge label distribution as a bar chart.`,
  },
  {
    key: 'llm_client',
    id: id('llm'),
    summary: 'llm.ts: dual-mode LLM client (Anthropic SDK or claude CLI fallback)',
    content: `LlmClient detects ANTHROPIC_API_KEY at construction time. If set, uses @anthropic-ai/sdk directly (faster, more control). If not, spawns claude -p as a subprocess (requires Claude Code or Pro session). Model selected via ZYGOMORPHIC_MODEL env var (default: claude-sonnet-4-6). Methods: call(prompt) -> string, callJSON<T>(prompt) -> T, stream(prompt) -> AsyncGenerator<string>. Retries up to 3 times with 2/4/6s backoff. 180s timeout, 16MB buffer. JSON extracted from fenced code blocks or bare objects/arrays.`,
  },
  {
    key: 'electron_shell',
    id: id('electron'),
    summary: 'electron/main.ts: desktop app entry point',
    content: `Startup sequence: initSchema() → loadFullGraph() → new Orchestrator() → dispatch GRAPH_LOADED → createWebServer() → startListening() → setInterval(deleteExpiredComments, 5min) → new BrowserWindow(). Window loads the local web server URL. On window close: stop listener, close server, close DB pool. Uses a random available port. BrowserWindow is 1280×900 with dark background. This is the primary deployment target.`,
  },
  {
    key: 'standalone_server',
    id: id('standalone'),
    summary: 'server/main.ts: headless server entry point for non-Electron deployment',
    content: `server/main.ts follows the same startup sequence as the Electron shell but without opening a BrowserWindow. Port from PORT env var (default 3000). Intended for server-side deployment where a browser is not available locally. Built via npm run build:server (tsconfig.server.json). The web UI is still served at GET / and accessible from any browser on the network.`,
  },
  {
    key: 'testing_strategy',
    id: id('testing'),
    summary: 'Vitest test suite: unit tests (reducer, MCP) and integration tests (db, orchestrator)',
    content: `Four test files:
- reducer.test.ts: pure unit tests, no DB, covers all AppEvent types
- mcp.test.ts: unit tests using InMemoryTransport; mock graph + dispatch; covers all 12 tools
- db.test.ts: integration tests against real Postgres; isolated via per-process schema (SET search_path TO test_<pid>); tests node/edge/comment CRUD, cascade delete, search, neighborhood
- orchestrator.test.ts: integration tests; full dispatch pipeline including DB persistence; also uses isolated schema

Run with: vitest run (or npm test)`,
  },
  {
    key: 'ci_pipeline',
    id: id('ci'),
    summary: 'GitHub Actions CI: typecheck and tests on push/PR to main',
    content: `.github/workflows/ci.yml runs on push to main and all PRs to main (not on pushes to other branches, to avoid duplicate runs). Job "check": spins up postgres:18 service container, sets ZYGOMORPHIC_DB_URL, runs npm ci, then npm run typecheck, then npm test. Node 22. Tests create isolated schemas so they can run in parallel without conflicts.`,
  },
  {
    key: 'realtime_flow',
    id: id('realtime_flow'),
    summary: 'End-to-end real-time flow: DB change → NOTIFY → reload → SSE → UI',
    content: `Full path of a change reaching the browser:
1. Agent calls MCP write tool (or human POSTs /action)
2. Orchestrator dispatches event → reduce() → persist() writes to Postgres
3. Postgres NOTIFY fires on the relevant table
4. startListening() client receives notification (debounced 200ms)
5. Orchestrator calls reload() → loadFullGraph() from DB
6. Orchestrator dispatches GRAPH_LOADED, emits "state"
7. Web server broadcasts state to all SSE clients
8. Browser receives "state" event, re-renders UI

Total latency: typically <300ms end-to-end on localhost.`,
  },
  {
    key: 'configuration',
    id: id('config'),
    summary: 'Environment variables and runtime configuration',
    content: `Environment variables:
- ZYGOMORPHIC_DB_URL: Postgres connection string (default: postgresql://rhizome@localhost/zygomorphic)
- ANTHROPIC_API_KEY: enables Anthropic SDK mode in llm.ts (fallback: claude CLI)
- ZYGOMORPHIC_MODEL: LLM model ID (default: claude-sonnet-4-6)
- PORT: standalone server port (default: 3000)

Build scripts:
- npm run build: compile Electron app (tsconfig.electron.json)
- npm run build:server: compile standalone server (tsconfig.server.json)
- npm start: build + launch Electron
- npm test: vitest run
- npm run typecheck: tsc --noEmit`,
  },
];

// Map key -> generated id
const ids: Record<string, string> = {};
for (const n of nodes) ids[n.key] = n.id;

const edges: Array<{ a: string; b: string; label: string }> = [
  { a: 'zygomorphic', b: 'design_philosophy', label: 'embodies' },
  { a: 'zygomorphic', b: 'graph_data_model', label: 'uses' },
  { a: 'zygomorphic', b: 'db_layer', label: 'persists_via' },
  { a: 'zygomorphic', b: 'orchestrator', label: 'coordinated_by' },
  { a: 'zygomorphic', b: 'mcp_server', label: 'exposes' },
  { a: 'zygomorphic', b: 'web_server', label: 'served_by' },
  { a: 'zygomorphic', b: 'electron_shell', label: 'packaged_as' },
  { a: 'zygomorphic', b: 'standalone_server', label: 'deployed_as' },
  { a: 'design_philosophy', b: 'mcp_server', label: 'shapes' },
  { a: 'graph_data_model', b: 'node_structure', label: 'contains' },
  { a: 'graph_data_model', b: 'edge_structure', label: 'contains' },
  { a: 'graph_data_model', b: 'comment_system', label: 'contains' },
  { a: 'graph_data_model', b: 'exploration_metadata', label: 'contains' },
  { a: 'db_layer', b: 'db_schema', label: 'defines' },
  { a: 'db_layer', b: 'db_search', label: 'provides' },
  { a: 'db_layer', b: 'db_neighborhood', label: 'provides' },
  { a: 'db_layer', b: 'db_realtime', label: 'implements' },
  { a: 'db_layer', b: 'graph_data_model', label: 'loads' },
  { a: 'state_machine', b: 'app_events', label: 'processes' },
  { a: 'state_machine', b: 'graph_data_model', label: 'holds' },
  { a: 'orchestrator', b: 'state_machine', label: 'uses' },
  { a: 'orchestrator', b: 'db_layer', label: 'writes_to' },
  { a: 'orchestrator', b: 'web_server', label: 'feeds' },
  { a: 'mcp_server', b: 'mcp_read_tools', label: 'provides' },
  { a: 'mcp_server', b: 'mcp_write_tools', label: 'provides' },
  { a: 'mcp_server', b: 'mcp_exploration_tools', label: 'provides' },
  { a: 'mcp_server', b: 'orchestrator', label: 'dispatches_via' },
  { a: 'mcp_server', b: 'graph_data_model', label: 'reads' },
  { a: 'web_server', b: 'sse_endpoint', label: 'exposes' },
  { a: 'web_server', b: 'action_endpoint', label: 'exposes' },
  { a: 'web_server', b: 'web_ui', label: 'serves' },
  { a: 'web_ui', b: 'graph_view', label: 'contains' },
  { a: 'web_ui', b: 'activity_stats_view', label: 'contains' },
  { a: 'web_ui', b: 'sse_endpoint', label: 'connects_to' },
  { a: 'web_ui', b: 'action_endpoint', label: 'posts_to' },
  { a: 'llm_client', b: 'orchestrator', label: 'used_by' },
  { a: 'electron_shell', b: 'orchestrator', label: 'initializes' },
  { a: 'electron_shell', b: 'db_layer', label: 'initializes' },
  { a: 'standalone_server', b: 'orchestrator', label: 'initializes' },
  { a: 'standalone_server', b: 'db_layer', label: 'initializes' },
  { a: 'db_realtime', b: 'realtime_flow', label: 'part_of' },
  { a: 'sse_endpoint', b: 'realtime_flow', label: 'part_of' },
  { a: 'orchestrator', b: 'realtime_flow', label: 'part_of' },
  { a: 'testing_strategy', b: 'db_layer', label: 'covers' },
  { a: 'testing_strategy', b: 'mcp_server', label: 'covers' },
  { a: 'testing_strategy', b: 'state_machine', label: 'covers' },
  { a: 'testing_strategy', b: 'orchestrator', label: 'covers' },
  { a: 'ci_pipeline', b: 'testing_strategy', label: 'runs' },
  { a: 'ci_pipeline', b: 'configuration', label: 'uses' },
  { a: 'configuration', b: 'db_layer', label: 'configures' },
  { a: 'configuration', b: 'llm_client', label: 'configures' },
  { a: 'configuration', b: 'standalone_server', label: 'configures' },
];

async function main() {
  console.log('Initializing schema...');
  await initSchema();

  console.log(`Inserting ${nodes.length} nodes...`);
  for (const n of nodes) {
    await insertNode({
      id: n.id,
      content: n.content,
      summary: n.summary,
      exploration: [],
      created_at: now,
      updated_at: now,
    });
    console.log(`  + [${n.key}]`);
  }

  console.log(`Inserting ${edges.length} edges...`);
  for (const e of edges) {
    const edgeId = id('e');
    await insertEdge({
      id: edgeId,
      a: ids[e.a]!,
      b: ids[e.b]!,
      label: e.label,
      created_at: now,
    });
    console.log(`  + ${e.a} --[${e.label}]--> ${e.b}`);
  }

  console.log('Done.');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
