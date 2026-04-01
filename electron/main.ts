import { app, BrowserWindow } from 'electron';
import { Orchestrator } from '../src/lib/orchestrator.js';
import { createWebServer } from '../src/lib/webserver.js';
import { initSchema, loadFullGraph, deleteExpiredComments, closePool } from '../src/lib/db.js';
import type { Server } from 'http';

let win: BrowserWindow | null = null;
let server: Server | null = null;
let expiryTimer: ReturnType<typeof setInterval> | null = null;

app.whenReady().then(async () => {
  await initSchema();
  const orch = new Orchestrator();

  const graph = await loadFullGraph();
  if (Object.keys(graph.nodes).length > 0) {
    await orch.dispatch({ type: 'GRAPH_LOADED', graph });
  }

  server = createWebServer(0, orch);

  // Expire old comments every 5 minutes
  expiryTimer = setInterval(() => deleteExpiredComments().catch(() => {}), 5 * 60_000);

  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const { port } = server!.address() as { port: number };

  win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'zygomorphic',
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${port}`);
  win.on('closed', () => { win = null; });
});

app.on('window-all-closed', () => {
  if (expiryTimer) clearInterval(expiryTimer);
  server?.close();
  closePool().catch(() => {});
  app.quit();
});
