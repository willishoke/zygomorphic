---
role: Electron desktop app shell — currently broken due to deleted module dependencies
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:49.988Z
---

Contains only main.ts, which creates a BrowserWindow loading the web server. Broken: imports orchestrator.js and db.js which were deleted in the refactor. Needs to be rewritten to use Store + createWebServer() before the packaged desktop app will work. The web server (server/main.ts) and MCP server (scripts/mcp-stdio.ts) are fully functional without this.
