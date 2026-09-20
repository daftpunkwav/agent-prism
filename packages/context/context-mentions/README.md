# `@agentprism/context-mentions`

`@file` mention grammar plus workspace resolution and candidate search.

- `grammar`: parse/format/validate `@path` and `@"spaced path"` mentions (email-safe).
- `resolve`: traversal-safe workspace reads and directory listings rendered as fenced context blocks.
- `search`: prefix/substring/fuzzy candidate ranking over workspace file lists.
- Depends only on `contracts` (filesystem access is structural, satisfied by the runtime Workspace fs).
