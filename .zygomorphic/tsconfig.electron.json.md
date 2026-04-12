---
role: TypeScript config for the Electron build (outputs to dist/electron/)
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:07.314Z
---

Extends tsconfig.json, includes electron/ and src/lib/, outputs to dist/electron/. Used by the build npm script and electron-builder packaging. Currently the electron/main.ts it compiles is broken due to deleted module imports.
