---
role: Browser UI: single-file vanilla JS tree browser served by webserver.ts
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:38.746Z
---

Contains only index.html — the entire frontend in one file. No build step, no framework. Served directly from disk by webserver.ts. Keep it self-contained; adding a build pipeline here would complicate the electron packaging and server deployment.
