# `@agentprism/context-compaction`

Checkpoint-style compaction over a generic message surface.

- `surface`: turn-frame surface with token metering (char proxy) and span selection.
- `checkpoint`: tagged checkpoint envelopes with `<compacted-summary>` sections,
  extractive fill, and an async summarizer port that accepts LLM-backed fill.
- `journal`: append-only compaction journal with undo (pop) and sequence guards.
- Zero dependencies (pure data structures, deterministic).
