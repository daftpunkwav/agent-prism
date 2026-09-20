# `@agentprism/memory-service`

`MemoryServicePort` adapter over the episodic and semantic stores.

- `MemoryServiceAdapter` forwards record and recall calls to the matching store.
- `recallAll` combines both stores in one result.
- Exists so the composition root injects a single port built from concrete file-backed
  stores.

## Dependencies

- Runtime: `contracts / memory-episodic / memory-semantic`.
