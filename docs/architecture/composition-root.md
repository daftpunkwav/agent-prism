# Composition root

`apps/server/src/assemble.ts` is the only composition root in the repository. It is the
only place that may construct the driver registry, call `registerDriversBestEffort`, and
mount the `register*Routes` leaves.

## Entry chain and process behavior

- `src/main.ts`: `assemble()`, then `startServer()`, then `installSignalHandlers()`.
- `src/server.ts`: `ensurePortAvailable(settings.backendHost, settings.backendPort)`
  before `serve(...)` from `@hono/node-server`, plus an `EADDRINUSE` error listener that
  covers the probe-to-bind race. Stop closes idle connections, then the server.
- `src/portcheck.ts`: throws `InvalidPortError` or `PortInUseError` when the port is out
  of 1 to 65535 or already in use. It never calls `process.exit`; the host entry logs and
  exits. There is no automatic fallback port.
- `src/lifecycle.ts`: SIGINT, SIGTERM, and SIGBREAK get a 5-second graceful-shutdown
  timeout before a forced `exit(1)`. `disposeSignalHandlers()` detaches listeners for
  tests and embedding hosts.
- The dev script runs `predev` with `tsc`, then `node --watch dist/main.js`. It watches
  compiled output. See [../operations/runbook.md](../operations/runbook.md).

## What `assemble()` creates, in order

Abbreviated walk of `apps/server/src/assemble.ts`:

1. `loadSettings()`. See [../reference/configuration.md](../reference/configuration.md).
2. Fail-fast auth guard. A non-loopback `BACKEND_HOST` with an empty `API_TOKEN` refuses
   to start. Loopback with an empty token only warns.
3. Base ports: `SystemClock` and `RandomIdGenerator`.
4. `ProviderConfigStore` over `AtomicJsonFile(data/provider_config.json)` with the `LLM_*`
   env seed, plus `EndpointCatalog`, `ProviderLookupAdapter`, and `DimensionCatalog`.
5. `WorkspaceRegistry({ runsRoot: data/runs, clock })`.
6. `ProviderDimensionSync` and `DimensionRouter`, with a provider-store change listener
   calling `router.invalidateProviderCache()`.
7. Report and judge wiring: `buildComparisonReport` with `createChatModel`, a
   `ColumnRuntimeFactory` built from `createColumnRuntime`, and `judgeAnswers`.
8. Drivers through `registerFrameworkDrivers()`, described below. Startup fails fast if
   zero drivers registered.
9. Builder runtime: a model factory with an LLM wire-trace handler, endpoint projection
   from the live provider config, and `BuilderSessionStore` over
   `AtomicJsonFile(data/builder_sessions.json)`.
10. Session ledger: `FileSessionStore` over `AtomicJsonFile(data/sessions.json)` with
    `FileBlobStore(data/sessions.json.blobs)` as the oversized-entry sidecar, then
    `SessionService` and `BuilderService`.
11. Capability-seam check: `prompt`, `reasoning`, `context`, `harness`, and `toolset` must
    each expose at least one option or startup throws.
12. MCP server resolution: `MCP_SERVERS` parses through `parseMcpServersEnv` and
    seeds the managed `McpServersStore`; once `data/mcp_servers.json` exists the file
    wins, and a malformed env config still warns once with
    `[assemble] MCP_SERVERS ignored` and startup continues with an empty seed. The
    store mutates one shared array in place so per-run consumers hot-reload after a
    settings save. The user-skills layer (`configureUserSkills`) wires the global
    `data/skills/` directory and the `data/skill_settings.json` disabled-name store
    with the same hot-apply shape.
13. Services: `ArenaService`, `MatrixService`, `ProviderService`, `WorkspaceFileService`,
    and `ProjectStore` over `AtomicJsonFile(data/projects.json)`.
14. `mountDomainRoutes(deps)` and a best-effort `router.syncModelOptionsFromProvider()`.

Two more singletons are assembled on the same pass. `RuntimeKnobsStore` over
`AtomicJsonFile(data/runtime_knobs.json)` holds file-backed overrides of the environment
defaults, and its update callback hot-applies context tuning, harness retry budgets, tool
budgets, and driver knobs. The cross-session memory stores `EpisodicMemory` over
`data/memory_episodic.json` and `SemanticMemory` over `data/memory_semantic.json` are
bridged into one `MemoryServiceAdapter`.

It returns `{ settings, app }`, typed as `RuntimeComponents`.

## Driver registration

`apps/server/src/load-drivers.ts` defines `builtinDriverLoaders`, the dynamic imports of
the seven backends.

| Framework id | Leaf |
|---|---|
| `native` | `@agentprism/driver-native` |
| `plan_execute` | `@agentprism/driver-plan-execute` |
| `self_critique` | `@agentprism/driver-self-critique` |
| `langchain` | `@agentprism/driver-langchain` |
| `langgraph` | `@agentprism/driver-langgraph` |
| `autogen` | `@agentprism/driver-autogen` |
| `crewai` | `@agentprism/driver-crewai` |

`registerDriversBestEffort(registry, loaders)` treats a failing backend as a warning
rather than an error, so only a fully empty registry fails startup. The optional
`DRIVERS` env var restricts the loader subset; unset means all builtins, and unknown
names warn and are ignored. Adding a backend means adding a loader here. See
[../guides/add-a-driver.md](../guides/add-a-driver.md).

## Route mounting

`apps/server/src/mount-routes.ts` mounts the eight route leaves in this order:

```
provider → settings → sessions → arena → workspace → projects → builder → threads
```

Order matters in one place: `GET /api/sessions/stats` is registered before
`GET /api/sessions/:sessionId` so a single-segment path cannot swallow it.

## Testing the composition

- `apps/server/tests/load-drivers.test.ts` is the composition smoke test: the registry is
  non-empty and contains `native`.
- `apps/server/tests/mount-routes.test.ts` checks one endpoint per route leaf plus a
  health probe.
- `apps/server/tests/assemble.test.ts` and `tests/http-transport/` pin the request
  contract end to end.
