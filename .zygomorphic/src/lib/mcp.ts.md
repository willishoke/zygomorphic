---
role: MCP server definition: all 7 tools (get_tree, get_node, get_children, assess_node, get_stale, search, record_exploration, get_exploration_state)
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:00.877Z
---

Creates the MCP server and registers all tools against a Store instance. The server is stateless beyond the store — no session state. Tool inputs are validated with zod schemas. Text formatting helpers (nodeToText) render nodes for agent consumption with staleness status (current/stale/unassessed) relative to HEAD commit. Also exports startStdioServer() which wires the server to a StdioServerTransport — this is the entry point used by scripts/mcp-stdio.ts. When adding new tools, register them here using server.tool().
