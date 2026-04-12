---
role: HTTP server: serves the tree browser UI and pushes live state via SSE
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:13.531Z
---

createWebServer() starts an HTTP server with three routes: GET /events (SSE stream), GET /state (last-known JSON snapshot), POST /focus (update focused node), and a catch-all that serves src/web/index.html. State is pushed to all connected SSE clients whenever .zygomorphic/ changes — a debounced fs.watch fires rebuildIndex() and then broadcasts the new tree. Module-level mutable state (clients array, cachedState string) means this module is not safe to instantiate multiple times in one process. HTML_PATH is resolved from process.cwd() at module load time, so the server must be started from the repo root.
