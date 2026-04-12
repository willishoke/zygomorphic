---
role: CLI entry points: init, mcp-stdio, check-stale, make-icon, and a stale export script
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:45.071Z
---

Runnable scripts using npx tsx. Active scripts: init.ts (workspace setup), mcp-stdio.ts (MCP server for Claude Code), check-stale.ts (CI gate), make-icon.mjs (icon regen). Stale/broken: export.ts (imports deleted db.js). The mcp-stdio.ts script is the one referenced in .mcp.json and is the primary integration point for AI agents.
