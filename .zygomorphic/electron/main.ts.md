---
role: STALE — Electron shell that imports deleted modules (orchestrator, db); not functional
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:35.394Z
---

Boots an Electron BrowserWindow pointing at the web server. Currently broken: imports Orchestrator from src/lib/orchestrator.js and initSchema/loadFullGraph/closePool/startListening from src/lib/db.js, both of which were deleted in the refactor. The Electron entry point needs to be rewritten to use the new Store + createWebServer() API before the desktop app will work again. The web server and MCP server are functional without Electron.
