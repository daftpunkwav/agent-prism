# `@agentprism/route-builder`

Builder domain routes: `registerBuilderRoutes(app, deps)` mounts catalog, session CRUD, hot-swap, and SSE streaming-chat endpoints.

## Dependencies

- Runtime: `contracts / http-runtime / builder-service` (services injected via `HttpApplicationDeps`), plus `hono` (SSE streaming).
