---
role: Vitest test runner configuration
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:10.079Z
---

Configures vitest for the project. The test files it previously covered (src/lib/db.test.ts, llm.test.ts, mcp.test.ts, orchestrator.test.ts, reducer.test.ts) have all been deleted as part of the refactor. The test suite is currently empty — any new tests for store.ts, filetree.ts, etc. should be added alongside those files.
