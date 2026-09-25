# `@agentprism/driver-run-support`

Driver seam: `FrameworkDriverRegistry` (implements `contracts.DriverLookup`; unknown frameworks throw `DriverNotFoundError`, reserved ones throw `DriverReservedError`), the injectable-loader `registerDriversBestEffort` registration helper, and run support shared by all backends (`event-translation`, `tool-batch`, `reasoning-constants`, `recursion-limit`, `step-budget`) plus the NDJSON framework-bridge transport (`bridge-protocol`, `child-bridge`) and the runtime probe (`python-probe`).

## Dependencies

- Runtime: `contracts / harness / telemetry`. No backend dependencies, no LangChain.
- Dev-only: the three backend leaves (banner-consistency contract tests).
