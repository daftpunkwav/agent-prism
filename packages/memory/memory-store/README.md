# `@agentprism/memory-store`

In-memory search index with atomic file persistence for memory items.

- `MemoryStore` loads and atomically persists typed collections through `AtomicJsonFile`.
- `tokenizeText` segments Latin words and CJK uni/bi-grams for robust partial matching.
- Term-frequency ranking over text representations; crash-safe across restarts.

## Dependencies

- Runtime: `persistence`.
