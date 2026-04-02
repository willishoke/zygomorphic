/**
 * HTTP server: serves the web UI, pushes state via SSE, accepts POST /action.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import type { Orchestrator } from './orchestrator.js';
import * as db from './db.js';
import type { ActivityItem, StatsData } from './types.js';

const HTML_PATH = path.join(process.cwd(), 'src/web/index.html');

let clients: http.ServerResponse[] = [];
let cachedState = '{}';

export function createWebServer(port = 7777, orch?: Orchestrator): http.Server {
  if (orch) {
    orch.on('state', (s: unknown) => pushState(s));
    pushState(orch.getState());
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

    if (req.url?.startsWith('/activity')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const sort = params.get('sort') === 'score' ? 'score' : 'recent';
      db.getActivityFeed(sort).then((items: ActivityItem[]) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
      }).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'activity fetch failed' }));
      });
      return;
    }

    if (req.url === '/stats') {
      db.getStats().then((stats: StatsData) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      }).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'stats fetch failed' }));
      });
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

        handleAction(orch, action).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
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

async function handleAction(orch: Orchestrator, action: Record<string, unknown>): Promise<void> {
  switch (action.type) {
    case 'focus':
      if (typeof action.nodeId === 'string') {
        await orch.dispatch({ type: 'FOCUS_CHANGED', nodeId: action.nodeId });
      }
      break;
    case 'navigate':
      if (typeof action.nodeId === 'string') {
        await orch.dispatch({ type: 'NAVIGATION_PUSH', nodeId: action.nodeId });
      }
      break;
    case 'navigate_back':
      await orch.dispatch({ type: 'NAVIGATION_BACK' });
      break;
    case 'refresh':
      await orch.reload();
      break;
    case 'refresh_comments':
      await orch.reloadComments();
      break;
    case 'delete_comment':
      if (typeof action.comment_id === 'string') {
        const delAuthor = typeof action.author === 'string' ? action.author : 'human';
        await orch.deleteComment(action.comment_id, delAuthor);
      }
      break;
    case 'edit_comment':
      if (
        typeof action.comment_id === 'string'
        && typeof action.content === 'string'
      ) {
        const editAuthor = typeof action.author === 'string' ? action.author : 'human';
        await orch.editComment(action.comment_id, editAuthor, action.content);
      }
      break;
    case 'vote_comment':
      if (
        typeof action.comment_id === 'string'
        && typeof action.author === 'string'
        && (action.vote === 1 || action.vote === -1)
      ) {
        await orch.voteComment(action.comment_id, action.author, action.vote as 1 | -1);
      }
      break;
    case 'add_comment':
      if (
        typeof action.node_id === 'string'
        && typeof action.content === 'string'
        && typeof action.author === 'string'
      ) {
        const now = new Date();
        const expiresIn = typeof action.expires_in_hours === 'number'
          ? new Date(now.getTime() + action.expires_in_hours * 3600_000).toISOString()
          : null;
        await orch.dispatch({
          type: 'COMMENT_ADDED',
          comment: {
            id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            node_id: action.node_id,
            content: action.content,
            author: action.author,
            created_at: now.toISOString(),
            updated_at: null,
            expires_at: expiresIn,
            score: 0,
            deleted_at: null,
          },
        });
      }
      break;
  }
}

export function pushState(state: unknown): void {
  cachedState = JSON.stringify(state);
  const msg = `data: ${cachedState}\n\n`;
  clients.forEach((c) => { try { c.write(msg); } catch { /* client gone */ } });
}
