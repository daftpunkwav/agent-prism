# `@agentprism/tool-symbols`

Regex-based code symbol index: definitions, references, and dependents.

- `index`: per-file definition extraction (function/class/interface/struct/enum
  plus arrow-const) with line numbers, no parsers, degrades gracefully.
- `query`: exact/prefix/substring symbol search, reference search with
  word boundaries, and reverse-dependency (importer) lookup.
- `tool`: read-only `symbols` builtin (defs/refs/search/dependents), all toolsets.
- Uses heuristics rather than a parser tree, so it has zero dependencies, is
  deterministic, and works on syntactically broken files. Depends on `contracts` +
  `tool-registry`.
