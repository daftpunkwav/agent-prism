# session/

Durable execution sessions: the lifecycle ledger for arena/agent runs (created → milestones → done/failed), persisted and re-queryable after disconnects. `session` is the IO-free seam (ports + in-memory implementation); `session-persistence` is the file backend. Note: builder authoring sessions keep their own store; this family tracks execution sessions only.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`session/`](session/README.md) | In-memory implementation: `InMemorySessionStore` (ports live in `contracts`) | Consumed by application services, tests, and the composition root |
| [`session-format/`](session-format/README.md) | Versioned document envelopes: migration chain, fail-closed validation | Consumed by persistence/projection/query |
| [`session-persistence/`](session-persistence/README.md) | File backend: `FileSessionStore` (single-document atomic writes, schema validation, stale-active → failed) | Registered at the composition root |
| [`session-projection/`](session-projection/README.md) | Cached read projections over session documents | Consumed by query surfaces |
| [`session-query/`](session-query/README.md) | Dependency-free query engine over the `SessionStore` port | Consumed by application services |
| [`session-telemetry/`](session-telemetry/README.md) | In-memory lifecycle telemetry with deterministic reports | Consumed by application services |
| [`session-title/`](session-title/README.md) | Deterministic session titles with an LLM-hook port | Consumed by application services |
| [`session-outline/`](session-outline/README.md) | Turn-outline projection over arena event streams | Consumed by application services |
