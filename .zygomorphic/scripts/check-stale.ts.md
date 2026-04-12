---
role: CI staleness check: exits 1 if any nodes are unassessed or assessed at a stale commit
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:28.247Z
---

Intended as a GitHub Actions gate. Rebuilds the index, calls getStale(), and exits with code 1 if anything is stale. Supports --json flag for machine-readable output and --limit N. The stale definition is: assessed_at_commit differs from current HEAD (or is null). Usage: npx tsx scripts/check-stale.ts [workspace-root] [--json] [--limit N].
