/**
 * Standalone server entry point — no Electron dependency.
 * Serves the web UI and SSE state stream on PORT (default 3000).
 */
import { Orchestrator } from '../src/lib/orchestrator.js';
import { createWebServer } from '../src/lib/webserver.js';
import { loadGraph, persistOnMutation } from '../src/lib/persistence.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const orch = new Orchestrator();

const saved = loadGraph();
if (saved) {
  orch.dispatch({ type: 'GRAPH_LOADED', graph: saved });
  console.log(`Loaded graph: ${Object.keys(saved.nodes).length} nodes`);
} else {
  console.log('No saved graph found, starting empty');
}

orch.on('state', persistOnMutation());

const server = createWebServer(PORT, orch);

server.once('listening', () => {
  console.log(`Listening on port ${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
