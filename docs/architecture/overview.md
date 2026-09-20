# System overview

Agent Prism is a multi-pipeline parallel-comparison platform: one question runs side by
side across different frameworks, prompts, reasoning modes, models, and tool policies,
and the streamed results are compared, judged, and archived.

This page is the conceptual map. [architecture.md](../architecture.md) defines the
capability families and dependency rules.

## Core concepts

| Concept | Meaning | Lives in |
|---|---|---|
| **Run** | One comparison execution: a question plus per-column selections | `@agentprism/arena` (`arena-runner`) |
| **Column / pipeline** | One side-by-side variant inside a run; the SSE `pipeline` field is its display label and aggregation key | `contracts/events.ts` (`ArenaEventBase`) |
| **Dimension** | One variable axis of comparison, with 14 ids: framework, prompt, reasoning, context, harness, temperature, model, thinking, max_steps, toolset, mcp, skill, orchestration, memory | `contracts/enums.ts`, `@agentprism/dimensions` |
| **Driver** | A loop-architecture backend implementing the `AgentDriver` port: native, langchain, langgraph, plan_execute, self_critique | `@agentprism/driver-*` |
| **Harness** | Neutral execution semantics: prompt assembly, context pipeline, reasoning modes, verification and reflection loops | `@agentprism/harness` |
| **Toolset** | A named tool table scope: `full` with 22 tools, `edit_run` with 19, `read_only` with 10 | `contracts/enums.ts` (`TOOL_NAMES_BY_TOOLSET`) |
| **Workspace** | A per-run or per-column scratch directory on disk under `data/runs/<runId>/<workspace>/` | `@agentprism/runtime` (`WorkspaceRegistry`) |
| **Session ledger** | The durable execution-session record, with kinds `arena`, `agent`, and `builder` and statuses `active`, `completed`, `failed`, and `cancelled` | `contracts/session.ts`, `@agentprism/session` |
| **Builder** | The conversational assembly service that composes a column from blocks and chats with it turn by turn | `@agentprism/builder` |
| **Template** | A task with a judge spec, 15 scored and 11 quick, used for one-click comparison matrices | `@agentprism/arena-routing` (`task-templates.ts`) |
| **Matrix** | 1 to 8 template cells executed sequentially through ArenaService with SSE progress | `@agentprism/application` (`MatrixService`) |

## Layer map

```
┌─────────────────────────────────────────────────┐
│  apps/web          (Next.js frontend, depends only on client/ui/arena-view) │
│  apps/server (composition root + HTTP host)                          │
├─────────────────────────────────────────────────┤
│  transport         Hono HTTP thin-protocol layer                             │
│  application       Use-case services (ArenaService et al.)                   │
├─────────────────────────────────────────────────┤
│  arena             Dimension routing + parallel Runner + breaker             │
│  agent             Single-column execution lifecycle                         │
│  drivers           Native / LangChain / LangGraph / PlanExecute / SelfCritique / AutoGen / CrewAI │
│  dimensions        Experiment dimension catalog and options                  │
│  evaluation        Judging, comparison reports, ablation rows, matrix        │
│  providers         LLM provider config and model construction                │
├─────────────────────────────────────────────────┤
│  harness           Prompt / context / verification loop                      │
│  tools             Tool seam + builtins + MCP                                │
│  memory            Cross-session memory                                      │
│  session           Execution-session ledger                                  │
│  builder           Conversational assembly service and turn execution        │
│  runtime           Workspace / Semaphore / breaker / Clock                   │
│  environment       Sandboxed FS / child processes                            │
│  config            Settings / paths / .env                                   │
│  persistence       JSON atomic storage                                       │
│  telemetry         Token / metrics                                           │
├─────────────────────────────────────────────────┤
│  contracts         Zod enums / event schemas / port definitions  ← leaf,     │
│                    zero runtime deps                                        │
│  client            Frontend API client        (both depend only on contracts)│
│  ui                Shared UI fragments                                       │
└─────────────────────────────────────────────────┘
```

The two-level layout `packages/<family>/<leaf>/` and the dependency rules between
families are defined in [package-layout.md](package-layout.md). The family role table is
in [packages/README.md](../../packages/README.md).

## Key ports, defined in `contracts` and injected at the composition root

| Port | Purpose | Notable consumers / implementers |
|---|---|---|
| `Clock` | Swappable time source, `now(): number` | WorkspaceRegistry, ArenaRunner, transport routes |
| `IdGenerator` | Swappable ID generation, `next(): string` | WorkspaceRegistry, ArenaRunner, ProviderConfigStore |
| `ProviderLookup` | Provider and endpoint query abstraction | DimensionRouter; arena never touches provider implementations |
| `AgentDriver` | The only framework-driver implementation boundary, `run(context): AsyncIterable<ArenaEvent>` | implemented by `driver-*`, consumed by ArenaRunner |
| `DriverLookup` | Resolve framework id to driver through `get`, `listAvailable`, and `listReserved` | adapted by `FrameworkDriverRegistry` |
| `ToolRegistry` | Register once at composition and select per-column toolset | implemented by `MapToolRegistry`, consumed by agent |
| `LlmAdapter` | Framework-neutral LLM port with `stream` and `invoke` | implemented in `provider-langchain`, bridged by drivers |
| `SessionStore`, `SessionQueryPort`, `SessionBlobStore` | Durable session lifecycle, read-only agent queries, and the oversized-entry sidecar | implemented by `session` and `session-persistence` |
| `ReportPublisher` | Comparison-report publishing | adapted by `evaluation`, consumed by ArenaRunner |
| `ColumnRuntimeFactory` | Per-column model handle factory | implemented by `provider-langchain.createColumnRuntime` |

`CircuitBreaker` is not a contracts port. It is the stateful breaker primitive inside
`runtime`, with the time source injected at construction, and it is held per endpoint by
ArenaRunner.

## Design invariants

1. `contracts` is the leaf. It imports zero `@agentprism/*` and everything may depend on
   it.
2. One composition root. `apps/server/src/assemble.ts` is the only place allowed to
   construct a driver registry and mount route leaves. See
   [composition-root.md](composition-root.md).
3. Seams first, backends register. Drivers, tools, and providers expose the seams
   `DriverLookup`, `ToolRegistry`, and `ProviderLookup`; backends are separate leaves
   that register at composition time. There is no global `ctx` container, only explicit
   parameter injection.
4. Observability never outranks availability. Session-ledger pathologies such as a full
   disk or a reached cap warn and never interrupt the run they observe.
5. Fail closed on ambiguity and warn on auxiliary failure. Unknown toolsets fall back to
   `read_only`; an unconfigured `web_search` refuses with a setup hint; a failed spill
   dump degrades to a truncated result with a warning rather than an error.
6. Enforcement boundaries. Static shell analysis is a guardrail, not a security boundary.
   The `sandbox_mode: os` setting adds OS-level write containment on Windows but does not
   control reads or network access. `ask_user` never blocks. Placeholders fail closed.
   See [sandbox-layers.md](sandbox-layers.md).

## Where to read next

- How one request flows end to end: [data-flow.md](data-flow.md)
- How everything is wired at startup: [composition-root.md](composition-root.md)
- Layout and naming conventions: [package-layout.md](package-layout.md)
