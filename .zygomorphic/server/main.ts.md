---
role: Web server entry point: initializes store and starts HTTP/SSE server
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:20.175Z
---

Standalone process that boots the tree browser. Accepts workspace root via argv[2] or ZYGOMORPHIC_WORKSPACE env var, falls back to cwd. Walks the file tree, rebuilds the SQLite index, then starts the HTTP server on PORT (default 3000). Handles SIGTERM/SIGINT for clean shutdown. Run with: npx tsx server/main.ts [workspace-root].
