import { app, BrowserWindow } from 'electron';
import { Orchestrator } from '../src/lib/orchestrator.js';
import { createWebServer } from '../src/lib/webserver.js';
import type { Server } from 'http';

let win: BrowserWindow | null = null;
let server: Server | null = null;

app.whenReady().then(async () => {
  const orch = new Orchestrator();
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
