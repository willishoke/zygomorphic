/**
 * HTTP server: serves the web UI, pushes state via SSE, accepts POST /action.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import type { Orchestrator } from './orchestrator.js';

// Resolve HTML relative to CWD so the same source file is served whether
// running from source or from a compiled dist/.
const HTML_PATH = path.join(process.cwd(), 'src/web/index.html');

let clients: http.ServerResponse[] = [];
let cachedState = '{}';

export function createWebServer(port = 7777, orch?: Orchestrator): http.Server {
  if (orch) {
    orch.on('state', (s: unknown) => pushState(s));
    pushState(orch.getState()); // seed initial state
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${cachedState}\n\n`);
      clients.push(res);
      req.on('close', () => { clients = clients.filter((c) => c !== res); });
      return;
    }

    if (req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(cachedState);
      return;
    }

    if (req.method === 'POST' && req.url === '/action') {
      if (!orch) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no orchestrator' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let action: Record<string, unknown>;
        try {
          action = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad json' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        if (orch && action.type === 'focus' && typeof action.nodeId === 'string') {
          orch.dispatch({ type: 'FOCUS_CHANGED', nodeId: action.nodeId });
        }
      });
      return;
    }

    fs.readFile(HTML_PATH, (err, data) => {
      if (err) { res.writeHead(500); res.end('web/index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });

  server.listen(port);
  return server;
}

export function pushState(state: unknown): void {
  cachedState = JSON.stringify(state);
  const msg = `data: ${cachedState}\n\n`;
  clients.forEach((c) => { try { c.write(msg); } catch { /* client gone */ } });
}
