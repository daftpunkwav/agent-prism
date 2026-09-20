# `@agentprism/runtime`

Workspace registry, semaphore, circuit breaker, clock, ID generation: synchronous primitives with no I/O orchestration.

> How it differs from `apps/server`: this package listens on no ports and assembles no services; that app is the full application (composition root + HTTP host). They are not on the same layer; do not confuse them.

## Dependencies

- Runtime: `contracts / environment`.
