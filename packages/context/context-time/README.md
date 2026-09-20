# `@agentprism/context-time`

Time anchoring for prompts and freshness budgets for retrieved context.

- `timestamp`: UTC formatting/parsing, day boundaries, injected clock (no ambient time).
- `invariant`: monotonicity and skew guards for event ordering.
- `freshness`: per-source staleness budgets (retrieval/snippets/tool output).
- Zero dependencies (pure functions, deterministic).
