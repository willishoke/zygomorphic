---
role: Git helpers: getHeadCommit() and isGitRepo() via child_process
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:08.711Z
---

Two thin wrappers over git CLI. getHeadCommit() returns the current HEAD SHA (used to stamp assessments and determine staleness). isGitRepo() checks if a directory is inside a git repository. Both return null/false gracefully if git is unavailable or the directory isn't a repo. The HEAD commit is the staleness signal: a node assessed at a different commit than HEAD is considered stale.
