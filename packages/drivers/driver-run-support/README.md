# `@agentprism/driver-run-support`

Driver seam: `FrameworkDriverRegistry` (implements `contracts.DriverLookup`; unknown frameworks throw `DriverNotFoundError`, reserved ones throw `DriverReservedError`), the injectable-loader `registerDriversBestEffort` registration helper, and run support shared by all backends (`event-translation`, `tool-batch`, `reasoning-constants`, `recursion-limit`, `step-budget`, `tool-schema`) plus the NDJSON framework-bridge transport (`bridge-protocol`, `child-bridge`) and the runtime probe (`python-probe`).

`tool-schema` is the single JSON-Schema → zod derivation shared by every backend that binds registry tools (LangChain StructuredTools, the MCP tool server).

## Dependencies

- Runtime: `contracts / harness / telemetry / zod`. No backend dependencies, no LangChain.
- The banner-consistency contract test lives at the repo root (`tests/drivers/`) and
  imports the backend leaves through their public barrels.
