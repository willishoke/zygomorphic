---
role: Icon generation script: renders assets/icon.svg to assets/icon.png via @resvg/resvg-js
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:02:16.667Z
---

Run via npm run make-icon. Uses @resvg/resvg-js to rasterize the SVG to a PNG suitable for electron-builder. Only needs to be re-run when the icon design changes.
