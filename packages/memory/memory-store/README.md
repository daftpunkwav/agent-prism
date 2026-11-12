# `@agentprism/memory-store`

In-memory search index with atomic file persistence for memory items.

- `MemoryStore` loads and atomically persists typed collections through `AtomicJsonFile`, and owns id allocation plus capped-collection trimming for the memory packs built on it. A persisted document that is not an array starts empty with a warning instead of crashing construction.
- `transact` runs a synchronous edit and persists once, so a prune and the insert it makes room for land in the same snapshot.
- `tokenizeText` segments Latin words and CJK uni/bi-grams, so partial matching works in both scripts.
- Term-frequency ranking over text representations; crash-safe across restarts.

## Dependencies

- Runtime: `persistence`.
