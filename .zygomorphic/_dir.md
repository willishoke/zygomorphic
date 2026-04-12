---
role: Zygomorphic: graph-structured memory and navigation layer for LLM agents, exposed via MCP and a web UI
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:59.616Z
---

A tool that lets AI agents (Claude Code, Cursor, etc.) navigate a workspace as a structured tree rather than flat files. Agents use MCP tools to orient at the top level, descend into relevant subtrees, and write assessments (role + detail) back to each node. Assessments are stored as markdown files in .zygomorphic/ (git-committable) with a SQLite index for fast queries and FTS. A web browser UI (served by server/main.ts) shows the same tree with live staleness indicators. The current implementation covers the read/assess/search path; the write/restructure/link path from DESIGN.md is not yet built. Key stale items: electron/main.ts and scripts/export.ts import deleted modules and need rewriting.
