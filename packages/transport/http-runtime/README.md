# `@agentprism/http-runtime`

HTTP shell: `createHttpApplication(deps)` (CORS, body-size precheck, API-token auth, health checks, error mapping), the shared route pipeline (`HttpApp` type, `assertBodySize`, `readJsonRaw`/`parseJsonBody`), and the `HttpApplicationDeps` dependency port. Mounts no domain routes; the composition root does the assembly.

## Dependencies

- Runtime: `application / builder-service / config / contracts` (mostly service types), plus `hono`.
