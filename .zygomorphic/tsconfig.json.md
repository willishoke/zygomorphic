---
role: Base TypeScript config (ESNext/ESM, bundler module resolution, strict)
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:02.267Z
---

Root tsconfig used for typechecking (tsc --noEmit). Sets target ESNext, module ESNext, moduleResolution bundler, strict mode. Extended by tsconfig.server.json and tsconfig.electron.json for their respective output directories.
