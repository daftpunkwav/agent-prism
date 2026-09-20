# `@agentprism/provider-capability`

Provider seam: endpoint catalog, config parsing and persistence, lookup adapter, thinking budget. Depends on `config` and `persistence` mostly for types; instances are injected by the composition root (e.g. `AtomicJsonFile`) to stay replaceable.

## Dependencies

- Runtime: `contracts / config / persistence` (the latter two mostly for types).
