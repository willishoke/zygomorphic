---
role: Architecture document: motivation, core concepts, MCP tool surface, and Anamorphic scaffolding notes
assessed_at_commit: ab65de644003e1d0ba5f5a6fbb2978db7e6fe472
created_at: 2026-04-04T06:58:17.044Z
updated_at: 2026-04-04T07:01:56.414Z
---

The primary design document. Explains the core problem (LLM context window as limited working memory), the insight (hierarchical graphs as compression), and what Zygomorphic is building. Covers: NodeData schema, summary propagation, neighborhood navigation, multi-agent exploration state, the full intended MCP tool surface (which is larger than what's currently implemented — create_node, update_node, link_nodes, restructure, get_neighborhood are not yet built), and the bidirectional Miller columns UI design. Also documents what was carried over from the Anamorphic fork and what was removed. Essential reading before making architectural decisions.
