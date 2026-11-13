# `@agentprism/context-mentions`

`@file` mention grammar plus workspace resolution and candidate search.

- `grammar`: parse/format/validate `@path` and `@"spaced path"` mentions (email-safe).
- `resolve`: traversal-safe workspace reads and directory listings rendered as fenced context blocks.
- `search`: prefix/substring/fuzzy candidate ranking over workspace file lists.
- `fence`: closing-tag escaping for fenced model-visible blocks; shared by the mention,
  RAG-snippet, and workspace-instruction fences so workspace text cannot end a frame early.
- No `@agentprism` dependencies: filesystem access is structural, satisfied by the runtime Workspace fs.
