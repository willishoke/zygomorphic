---
role: Shared TypeScript interfaces: NodeData, TreeData, ExplorationEntry, WebState
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:00:53.614Z
---

The single source of type truth for the whole system. NodeData represents one node in the tree — leaf or directory — carrying its path, structural metadata (parent_id, depth, is_leaf), assessment fields (role, detail, assessed_at_commit), and ephemeral exploration history. TreeData is the flat map of all nodes keyed by id. WebState is the snapshot pushed over SSE to the browser. No logic lives here; every other module imports from this file.
