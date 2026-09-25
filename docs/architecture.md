# Architecture

Agent Prism is a multi-pipeline parallel-comparison platform. This document defines the
system structure: capability families, dependency directions, and the shared vocabulary.
When this document disagrees with the code, the code and
`scripts/check-boundaries.mjs` are authoritative.

## 1. Design principles

The `packages/<capability-family>/<leaf>` two-level structure rests on three mechanisms.

1. Seams first. Seam packages define abstract services and bind no implementation.
   `tool-registry` owns `ToolRegistry`, `driver-registry` owns `DriverLookup`, and
   `provider-capability` owns `ProviderLookup`. Implementations live in separate leaves.
2. Backend registration. Each backend leaf is packaged and declared independently and
   registers at composition time. Driver backends register on `DriverLookup`: `native`
   runs in process, `langchain` and `langgraph` bridge external frameworks, and
   `plan_execute` and `self_critique` are native-family loops. Tool implementations
   register on `ToolRegistry`: `tool-builtins` and `tool-mcp`.
3. Explicit composition. `apps/server/src/assemble.ts` assembles the single deliverable.
   Each capability-family directory carries a `Package | Role | Seam` table in its
   `README.md`; each leaf ships `src/`, `tests/`, `README.md`, `package.json`, and
   `tsconfig.json`.

There is no global context object. Assembly uses explicit parameter injection and
registry instances, and the composition root is unique. See
[composition-root.md](architecture/composition-root.md).

## 2. Capability family map

`Package | Role | Seam / registration key`. The registration key is the seam surface the
package exposes and that can be replaced by another implementation.

| Package | Role | Seam / registration key |
|---|---|---|
| `contracts` | Repo-wide vocabulary and port layer: events, enums, validation, port interfaces | `ToolRegistry`, `DriverLookup`, `ProviderLookup`, `AgentDriver`, `LlmAdapter` ports; no registration keys, no @agentprism dependencies |
| `environment` | Sandboxed filesystem and child-process execution | `ScopedFileSystem`, `runProcess`; no registration key |
| `runtime` | Workspace registry, semaphore, circuit breaker, clock, IDs | Concrete pieces such as `WorkspaceRegistry` and `SystemClock`; no registration key |
| `persistence` | JSON atomic file storage | `AtomicJsonFile`; no registration key |
| `config` | Settings, paths, and `.env` loading | `loadSettings`; no registration key |
| `telemetry` | Token accounting and metrics | `TokenTracker`, `buildMetrics`; no registration key |
| `harness` | Neutral execution semantics: context pipeline, prompt assembly, reasoning modes, verification loop | `AgentExecutionContext`, `applyContextPipeline`, `MapPromptSectionRegistry`, `MapContextPolicyRegistry`, `tool-guard` |
| `memory/{memory-store, memory-episodic, memory-semantic, memory-service}` | Cross-session memory: atomic store and search index, episodic and semantic layers, and the service port adapter | `MemoryServicePort` adapter consumes `contracts` and `persistence`; mounted by the composition root |
| `tools/tool-registry` | Tool seam, no implementation | `MapToolRegistry` implements `contracts.ToolRegistry`; `normalizeToolset`, `selectToolNames`, `selectToolRegistry` |
| `tools/tool-builtins` | Built-in tool implementations | `createBuiltinToolRegistry` with read, write, edit, ls, bash, apply-patch, glob, grep, web_fetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter |
| `drivers/driver-registry` | Driver seam and shared runtime support | `FrameworkDriverRegistry` implements `contracts.DriverLookup`; `registerDriversBestEffort` takes injected loaders and warns on a failing backend |
| `drivers/driver-native` | In-process native backend | registered as `native` on `DriverLookup` |
| `drivers/driver-langchain` | LangChain backend and LC/message bridging | registered as `langchain` on `DriverLookup` |
| `drivers/driver-langgraph` | LangGraph reasoning-graph backend | registered as `langgraph` on `DriverLookup` |
| `drivers/driver-plan-execute` | Plan-Execute backend: planner pass plus a ReAct executor with one budgeted replan | registered as `plan_execute` on `DriverLookup` |
| `drivers/driver-self-critique` | Self-Critique backend: a tool-less critic scores each tool batch and redirects | registered as `self_critique` on `DriverLookup` |
| `drivers/driver-autogen` | AutoGen-pattern backend: group chat with LLM speaker selection | registered as `autogen` on `DriverLookup` |
| `drivers/driver-crewai` | CrewAI-pattern backend: role crew running a task pipeline | registered as `crewai` on `DriverLookup` |
| `providers/provider-capability` | Provider seam, no SDK | `ProviderLookupAdapter` implements `contracts.ProviderLookup`; `EndpointCatalog`, `ProviderConfigStore` |
| `providers/provider-langchain` | SDK adaptation and model construction | `createChatModel`, `createColumnRuntime`, `testProviderConnection` |
| `transport/http-runtime` | HTTP shell: middleware, health checks, error mapping | `createHttpApplication`, `HttpApplicationDeps`, `HttpApp` |
| `transport/route-*` (8 route leaves) | Domain route registrars, including session read/delete, durable threads, and settings knobs | `register*Routes(app, deps)`, mounted by the composition root |
| `dimensions` | Experiment dimension catalog and options | `DimensionCatalog` |
| `agent` | Single-column execution lifecycle; assembles the sandbox deny policy by default | no registration key; consumes `harness`, `tool-registry`, `tool-builtins`, `sandbox` |
| `arena/arena-routing` | Dimension routing and baselines | `DimensionRouter`, `ProviderDimensionSync`, `buildCapabilityOptionProjection`, baselines and templates |
| `arena/arena-runner` | Parallel multi-column execution | `ArenaRunner`, column-factory port `contracts.ColumnRuntimeFactory` |
| `evaluation` | Judging and comparison reports | `judgeAnswers`, `buildComparisonReport` |
| `application` | Use-case services: arena, provider, workspace, projects, sessions | `ArenaService`, `ProviderService`, `WorkspaceFileService`, `ProjectStore`, `SessionService` |
| `builder/builder-service` | Assembly-service orchestration: sessions, catalog, hot updates | `BuilderService`, `BuilderSessionStore` |
| `builder/builder-turns` | Turn execution: drivers, composition, blocks, trace log | `runBuilderTurn`, `BuilderModelRuntimeFactory`, composition functions |
| `client` | HTTP/SSE client for the web app | no registration key; depends only on `contracts` |
| `arena-view` | Pure view projections: column state, trace events, final-answer extraction | no registration key; depends only on `contracts` |
| `ui` | Presentation components, React peer | no registration key; depends only on `contracts` |
| `session/session` | In-memory session store implementation, port in `contracts` | `InMemorySessionStore` |
| `session/session-persistence` | Session file backend | `FileSessionStore` |
| `sandbox/sandbox` | Shell safety policy and hook adapters | `DenyListSandboxPolicy`, `toBeforeExecute` |
| `apps/server` | The only composition root: registers drivers, mounts routes, assembles services, owns port listening | `assemble()` |
| `apps/web` | Next.js frontend | may depend only on `client`, `ui`, and `arena-view`; gate-enforced |

## 3. Dependency directions

Directions are cross-checked between `pnpm` declarations and actual `src` imports, and
are acyclic.

```
apps/web ──► client / ui / arena-view ──► contracts
apps/server (assemble) ──► application / arena / drivers / providers / transport / …
http-runtime + route-* ──► application / builder ──► arena ──► agent ──► harness ──► runtime ──► environment
(route-* ──► http-runtime; the shell never depends back on routes)  │          │          └──────► telemetry ──► contracts
                                           │          └─────► tool-builtins ──► tool-registry ──► contracts
                                           └─────► dimensions ──► contracts
driver-* ──► driver-registry ──► harness + telemetry; langchain and langgraph leaves additionally carry @langchain/* external deps
provider-langchain ──► provider-capability ──► config + persistence
evaluation ──► contracts + runtime
client / config / dimensions / ui / arena-view ──► contracts
contracts / environment / persistence ──► no @agentprism dependencies; leaf nodes
```

Iron rules are enforced by `scripts/check-boundaries.mjs`. Declaration honesty is
enforced by `scripts/check-package-deps.mjs` through `pnpm check:deps`.

- `contracts` imports zero `@agentprism/*`; `harness` imports zero `@langchain/*`.
- `tool-registry` depends only on `contracts`; `tool-builtins` only on
  `contracts`, `environment`, `tool-registry`, and `tool-symbols`; `tool-mcp` only on
  `contracts` and `tool-registry`. The tool seam sits below both the composer and the
  implementations.
- `driver-registry` depends only on `contracts`, `environment`, `runtime`, `telemetry`,
  and `harness`, with zero backend dependencies. `driver-native` and `driver-langchain`
  additionally take `driver-registry`; `driver-langgraph` additionally takes
  `driver-langchain`. Driver plugins consume the harness seam and never depend on a
  composer or on providers. Their relation to tools goes through `contracts` types such
  as `ToolDefinition` and never through concrete tool packages.
- `provider-capability` depends only on `contracts`, `config`, `persistence`,
  `environment`, `runtime`, and `telemetry`; `provider-langchain` additionally takes
  `provider-capability`.
- `http-runtime` depends only on `application`, `builder`, `config`, and `contracts`.
  `route-*` depends only on `application`, `builder`, `config`, `contracts`, and
  `http-runtime`. Routes depend on the shell; the shell never depends back on routes.
  There are zero package-level cycles.
- `arena` never touches `@langchain/*` or providers. `application` never touches
  provider, evaluation, or harness implementations. `evaluation` touches only
  `contracts` and `runtime`; LLM calls arrive through injected text seams and the LC
  adapter lives in the composition root. `dimensions` touches only `contracts`.
  `apps/web` depends only on client, ui, and arena-view.
- Injection seams are used for effectful dependencies such as clocks and stores. Pure
  contract-level projections such as `extractAnswerFromEvents` are consumed directly
  from `contracts` and are not injected.

## 4. Vocabulary

These terms recur across packages with scoped meanings.

- **session**: the execution-ledger record for one arena, agent, or builder run
  (`contracts` `SessionKind`, tracked by the `session` family). A builder authoring
  session is a separate store, `builder-service` `BuilderSessionStore`, and is not a
  ledger session.
- **thread**: a durable agent conversation with a persistent transcript and workspace
  (`/api/threads`, `ThreadService`) that supports fork and resume across restarts.
- **column**: one parallel lane in an arena comparison run, consisting of a pipeline
  config and its event stream. Column labels are the aggregation key for events and
  reports.
- **worker**: the in-process async task that executes one column, `spawnWorker` in the
  runner. A worker runs exactly one column and never leaves the server process.
- **pipeline**: the per-column configuration bundle `PipelineConfig`, used as a label
  and key in event and report maps.
- **job / task / turn**: a job is the background arena run process `run-job`; a task is a
  preset judged exercise from `task-templates`; a turn is one request/response cycle of a
  builder or thread conversation.
- **endpoint vs model**: an endpoint is a configured provider target with id, base URL,
  and credentials. A model is the model name requested at that endpoint. Historical
  naming: the arena dimension id `model` selects endpoints, so its option values are
  endpoint ids disambiguated by label. This is kept for compatibility with persisted
  pipeline configs and the web catalogs.
