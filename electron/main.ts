import { app, BrowserWindow } from 'electron';
import { Orchestrator } from '../src/lib/orchestrator.js';
import { createWebServer } from '../src/lib/webserver.js';
import { loadGraph, persistOnMutation } from '../src/lib/persistence.js';
import type { Server } from 'http';

let win: BrowserWindow | null = null;
let server: Server | null = null;

app.whenReady().then(async () => {
  const orch = new Orchestrator();

  // Load persisted graph if it exists
  const saved = loadGraph();
  if (saved) {
    orch.dispatch({ type: 'GRAPH_LOADED', graph: saved });
  }

  // Auto-save on every state mutation
  orch.on('state', persistOnMutation());

  server = createWebServer(0, orch);

  // Wait for the HTTP server to be listening before opening the window
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
  server?.close();
  app.quit();
});
