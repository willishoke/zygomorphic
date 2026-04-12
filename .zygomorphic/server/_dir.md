---
role: Standalone web server entry point for the tree browser UI
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:47.123Z
---

Contains only main.ts — a thin bootstrap that wires Store + walkTree + createWebServer together and starts listening. Used when running the browser UI outside of Electron (e.g. on a VPS or for local development without the desktop app).
