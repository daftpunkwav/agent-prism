# `@agentprism/session-telemetry`

In-memory session lifecycle telemetry with deterministic reports.

- `counters`: started/finished-by-status/entry counts per kind, durations.
- `report`: stable text summaries for logs and dashboards.
- Observes, never persists: the ledger stays the source of truth.
- Depends on `contracts` session vocabulary (types only).
