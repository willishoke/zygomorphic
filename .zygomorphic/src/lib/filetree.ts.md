---
role: Filesystem walker: produces the list of paths fed into Store.rebuildIndex()
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:05.486Z
---

walkTree() does a recursive readdir from the workspace root, skipping common ignored directories (node_modules, .git, dist, .zygomorphic itself, etc.) and all dotfiles except .gitignore. Returns {path, isLeaf} pairs with forward-slash paths relative to workspaceRoot. ensureMirror() creates empty .md stubs in .zygomorphic/ for any path that doesn't yet have one — used only by scripts/init.ts on first setup. The ignore set intentionally excludes STORE_DIR to prevent the mirror from indexing itself.
