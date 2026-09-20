# memory/

Cross-session memory behind a neutral port. `memory-store` provides atomic persistence and
a term-frequency search index, `memory-episodic` records task post-mortems,
`memory-semantic` records structured facts, and `memory-service` bridges both into
`MemoryServicePort`. The `memory` comparison dimension selects which layers mount into the
prompt.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`memory-store/`](memory-store/README.md) | Atomic JSON persistence plus a multi-language term-frequency search index | below the two memory kinds |
| [`memory-episodic/`](memory-episodic/README.md) | Task post-mortems with deduplication and relevance recall | `memory-service` |
| [`memory-semantic/`](memory-semantic/README.md) | Subject/predicate/object facts with validity windows and TTL | `memory-service` |
| [`memory-service/`](memory-service/README.md) | `MemoryServicePort` adapter over the episodic and semantic stores | composition root |

The leaves depend on `contracts` and `persistence` only, never on `harness` or `agent`.
