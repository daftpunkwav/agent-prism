# `@agentprism/driver-registry`

Driver seam: `FrameworkDriverRegistry` (implements `contracts.DriverLookup`; unknown frameworks throw `DriverNotFoundError`, reserved ones throw `DriverReservedError`), the injectable-loader `registerDriversBestEffort` registration helper, and run support shared by all backends (`event-translation`, `capability-banner`, `reasoning-constants`, `recursion-limit`, `step-budget`).

## Dependencies

- Runtime: `contracts / harness / telemetry`. No backend dependencies, no LangChain.
- Dev-only: the three backend leaves (banner-consistency contract tests).
