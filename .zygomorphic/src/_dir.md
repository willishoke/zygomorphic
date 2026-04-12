---
role: All application source: library modules (src/lib) and browser UI (src/web)
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:41.270Z
---

Top-level source directory. Split into lib/ (Node.js modules, importable by server and scripts) and web/ (browser-side HTML/JS). Nothing in src/ should have a dependency on scripts/ or server/ — the dependency flow is always inward.
