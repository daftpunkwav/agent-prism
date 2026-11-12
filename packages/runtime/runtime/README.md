# `@agentprism/runtime`

Workspace lifecycle registry (TTL/LRU eviction, fork clones, run trace directories), semaphore, event channel, circuit breaker with timeout/retry helpers, `ask_user` human channel, clock, and ID generation: shared runtime primitives with no I/O orchestration of their own.

> How it differs from `apps/server`: this package listens on no ports and assembles no services; that app is the full application (composition root + HTTP host). They are not on the same layer; do not confuse them.

## Dependencies

- Runtime: `contracts / environment`.
