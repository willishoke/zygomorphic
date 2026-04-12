---
role: Single-file browser UI: tree sidebar + detail pane, driven by SSE from the web server
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:47.491Z
---

Vanilla JS, no build step. Connects to /events via EventSource and re-renders on every state push. Left sidebar renders the file tree with expand/collapse and color-coded staleness indicators (green=current, yellow=stale, grey=unassessed). Right pane shows full node detail, role, assessment status badge, and exploration history. POST /focus updates the focused node. All HTML is generated via innerHTML with an esc() XSS sanitizer. The file is served directly from disk by webserver.ts (resolved relative to process.cwd()), so the server must be started from the repo root.
