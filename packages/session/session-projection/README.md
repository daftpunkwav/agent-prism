# `@agentprism/session-projection`

Cached read projections over session documents.

- `projection`: digest views (record summary, entry windows, verdict rollup).
- `cache`: digest-keyed view cache with explicit invalidation (no timers).
- Depends on `contracts` vocabulary and `session-format` envelopes.
