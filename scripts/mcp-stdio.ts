/**
 * Stdio entry point for the zygomorphic MCP server.
 * Loads the graph from Postgres, wires up the orchestrator,
 * and exposes all MCP tools over stdin/stdout.
 */
import { Orchestrator } from '../src/lib/orchestrator.js';
import { startStdioServer } from '../src/lib/mcp.js';
import * as db from '../src/lib/db.js';

async function main() {
  const graph = await db.loadFullGraph();
  const orch = new Orchestrator();
  orch.dispatch({ type: 'GRAPH_LOADED', graph });

  await startStdioServer(
    graph,
    (event) => orch.dispatch(event),
    (id, author) => orch.deleteComment(id, author),
    (id, author, content) => orch.editComment(id, author, content),
    (id, author, vote) => orch.voteComment(id, author, vote),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
