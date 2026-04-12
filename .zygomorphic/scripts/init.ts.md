---
role: One-time init: creates .zygomorphic/ mirror stubs and builds the initial SQLite index
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:24.753Z
---

Run once to set up a workspace. Calls ensureMirror() to create empty .md files for every path in the tree, then rebuildIndex() to populate SQLite. Safe to re-run (ensureMirror skips existing files, rebuildIndex upserts). Usage: npx tsx scripts/init.ts [workspace-root].
