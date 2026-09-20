# transport/

Hono HTTP thin-protocol layer. `http-runtime` is a shell holding only middleware, health checks, and error mapping; the eight `route-*` leaves each mount one domain route, all assembled explicitly by the composition root (`apps/server`). The shell never imports route leaves, so package-level cycles are zero.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`http-runtime/`](http-runtime/README.md) | HTTP shell: `createHttpApplication`, shared route pipeline (`HttpApp`, `assertBodySize`, JSON body parsing), `HttpApplicationDeps` | Consumed by route leaves and the composition root |
| [`route-arena/`](route-arena/README.md) | Arena run/query/judge routes: `registerArenaRoutes` | Mounted onto the shell |
| [`route-builder/`](route-builder/README.md) | Builder session/CRUD/hot-swap/streaming-chat routes: `registerBuilderRoutes` | Mounted onto the shell |
| [`route-projects/`](route-projects/README.md) | Project routes: `registerProjectRoutes` | Mounted onto the shell |
| [`route-provider/`](route-provider/README.md) | Provider config routes: `registerProviderRoutes` | Mounted onto the shell |
| [`route-workspace/`](route-workspace/README.md) | Workspace file routes: `registerWorkspaceRoutes` | Mounted onto the shell |
| [`route-sessions/`](route-sessions/README.md) | Session read routes: `registerSessionRoutes` | Mounted onto the shell |
| [`route-threads/`](route-threads/README.md) | Durable agent-thread routes (fork/resume, SSE): `registerThreadRoutes` | Mounted onto the shell |
| [`route-settings/`](route-settings/README.md) | Runtime knob and memory-status routes: `registerSettingsRoutes` | Mounted onto the shell |

### URL namespaces

Leaf names and URL namespaces diverge where the API surface predates the leaf
split: `route-provider` serves `/api/settings/provider*`, while
`route-projects` and `route-workspace` serve under `/api/arena/*`; the other
leaves serve top-level `/api/<domain>`. The paths are kept for client
compatibility; new domains must mount top-level `/api/<domain>`.
