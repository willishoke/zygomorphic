---
role: Persistence layer: markdown files as truth, SQLite as derived index
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:00:55.533Z
---

The Store class owns all reads and writes. Assessment data lives in .zygomorphic/*.md files (human-readable, git-committable); SQLite (.zygomorphic/.index.db, gitignored) is rebuilt from those files plus the live file tree on every rebuildIndex() call. Key design: the markdown files are the source of truth so assessments are versionable in git, while SQLite provides fast querying and FTS. Exploration entries are SQLite-only (ephemeral session state). Path mapping: directories use _dir.md, files use <path>.md. The FTS5 virtual table enables full-text search across role and detail fields. Before editing: understand that rebuildIndex() is called on startup and on every .zygomorphic/ watch event, so it must be idempotent.
