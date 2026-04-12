---
role: Stdio MCP entry point: boots the MCP server for Claude Code / Cursor integration
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:22.713Z
---

Minimal bootstrap for the stdio MCP transport. Accepts workspace root via argv[2] or ZYGOMORPHIC_WORKSPACE, walks the file tree, rebuilds the index, then calls startStdioServer(). This is the script referenced in .mcp.json — it's what Claude Code spawns to get the zygomorphic MCP server. No HTTP server is started here; it's MCP-only.
