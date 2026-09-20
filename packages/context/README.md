# context/

Standalone context capabilities for prompts and retrieval, split into deterministic
leaves: chunking + retrieval feed harness RAG ingestion, mentions + time feed prompt
assembly, analytics tracks token distributions and strategy effectiveness, budget + compaction
power source-budget and checkpoint strategies, and instructions load repo/workspace AGENTS.md layers.
Note: the in-pipeline context strategies (sliding/tool_tail/token_budget/budget/checkpoint/…)
live inside `harness/context/*`; this family holds the reusable capabilities below it.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`context-chunking/`](context-chunking/README.md) | Structure-aware chunking for retrieval ingestion (code / markdown / CJK-text splitters with metadata) | harness `memory/rag.ts` |
| [`context-retrieval/`](context-retrieval/README.md) | Multi-signal retrieval: Okapi BM25, reciprocal-rank fusion, MMR diversification, budgeted in-memory index | harness `memory/rag.ts` |
| [`context-mentions/`](context-mentions/README.md) | `@file` mention grammar, traversal-safe workspace resolution, candidate search | harness `prompt/assembly.ts` |
| [`context-time/`](context-time/README.md) | UTC timestamp anchoring via injected clock, monotonicity guards, per-source freshness budgets | harness `prompt/prompt-builder.ts` |
| [`context-analytics/`](context-analytics/README.md) | Context usage measurement and strategy effectiveness counters for ablation grounding | harness `context/analytics.ts` & agent `agent-execution.ts` |
| [`context-budget/`](context-budget/README.md) | Per-source token budgeting with priority allocation and `[Budget ledger]` rendering | harness `context/budget-strategy.ts` (`budget` strategy) |
| [`context-compaction/`](context-compaction/README.md) | Checkpoint-style compaction envelopes with journal + undo and an async summarizer port | harness `context/checkpoint-strategy.ts` (`checkpoint` strategy) |
| [`context-instructions/`](context-instructions/README.md) | Layered agent instructions: repo defaults + workspace `AGENTS.md` overrides with digest-based refresh | harness `prompt/instructions.ts` & `prompt/assembly.ts` |

All leaves are pure and deterministic (zero dependencies, or `contracts` only for the
two that touch the filesystem structurally) and sit below `harness` in the dependency
graph.
