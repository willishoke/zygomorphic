---
role: Core library: store, MCP server, file walker, git helpers, web server, shared types
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:36.334Z
---

The heart of the project. Five modules form a clear dependency chain: types.ts defines interfaces → git.ts and filetree.ts are leaf utilities → store.ts owns persistence (markdown + SQLite) → mcp.ts and webserver.ts both depend on store.ts and expose it over different transports (stdio MCP and HTTP/SSE respectively). No circular dependencies. All business logic lives here; the scripts/ and server/ directories are thin entry points that wire these together.
