---
role: STALE — imports deleted db.js/loadFullGraph; was a graph JSON export script from the old architecture
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:32.688Z
---

This script is broken: it imports loadFullGraph, initSchema, and closePool from src/lib/db.js, which has been deleted as part of the refactor to the markdown+SQLite store. It was used to export the old in-memory graph to graph.json. Either delete it or rewrite it against the new Store API (store.getTree() replaces loadFullGraph). Do not run this file — it will throw a module-not-found error.
