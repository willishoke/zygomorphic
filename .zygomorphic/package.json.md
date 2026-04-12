---
role: Project manifest: ESM, Electron app target, dependencies (MCP SDK, better-sqlite3, zod)
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:51.807Z
---

Declares the project as ESM (type: module). Main dependencies are @modelcontextprotocol/sdk, better-sqlite3, and zod. Dev tooling is tsx (for running TS directly), vitest, and @resvg/resvg-js (for icon generation). Build scripts: build (electron), build:server (server), typecheck, test. electron-builder config targets mac/linux/win. The electron entry point is dist/electron/main.js — the compiled output of electron/main.ts, which is currently broken.
