# `@agentprism/route-arena`

Arena domain routes: `registerArenaRoutes(app, deps)` mounts run-launch, column-query, streaming-event, and judging endpoints.

## Dependencies

- Runtime: `contracts / http-runtime` (services injected via `HttpApplicationDeps`), plus `hono` (SSE streaming).
