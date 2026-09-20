# Agent Prism

Multi-pipeline parallel-comparison experiment platform. One question runs across
different frameworks, prompts, reasoning modes, models, and tool policies, and the
streamed results are compared side by side.

## Quick start

```bash
pnpm install
pnpm dev:server   # Backend Hono HTTP (port 8281)
pnpm dev:web       # Frontend Next.js (port 8280)
```

## Architecture

### Layers

```
apps/web          Next.js frontend, depends only on client, ui, arena-view
apps/server       Composition root and HTTP host

transport         Hono HTTP thin-protocol layer
application       Use-case services (ArenaService and others)

arena             Dimension routing, parallel Runner, breaker
agent             Single-column execution lifecycle
drivers           Native / LangChain / LangGraph / PlanExecute / SelfCritique / AutoGen / CrewAI
dimensions        Experiment dimension catalog and options
evaluation        Judging and comparison reports
providers         LLM provider config and model construction

harness           Prompt, context, and verification loop
tools             Tool seam, builtins, and MCP
memory            Cross-session memory (episodic and semantic)
session           Execution-session ledger with cancel semantics
builder           Conversational assembly service and turn execution
runtime           Workspace, Semaphore, breaker, Clock
environment       Sandboxed filesystem and child processes
config            Settings, paths, .env
persistence       JSON atomic storage
telemetry         Token and metrics

contracts         Zod enums, event schemas, port definitions; zero-dependency leaf
client            Frontend API client
ui                Shared UI fragments
```

### Dependency rules

1. `contracts` is the leaf. Every package may depend on it, and it depends on no business
   package.
2. The composition root lives only in `apps/server/src/assemble.ts` and owns all wiring.
3. `transport` is a thin protocol layer: JSON parsing, auth, error mapping, and SSE
   serialization only.
4. `arena` queries providers through the `ProviderLookup` port and never depends on
   provider implementations directly.
5. `dimensions` reads reasoning-mode metadata through `REASONING_MODE_META` and never
   depends on `harness`.

### Key ports from `contracts`

| Port | Purpose | Injected at |
|---|---|---|
| `Clock` | Swappable time source | WorkspaceRegistry, ArenaRunner, transport |
| `IdGenerator` | Swappable ID generation | WorkspaceRegistry, ArenaRunner, ProviderConfigStore |
| `ProviderLookup` | Provider query abstraction | DimensionRouter |
| `AgentDriver` | The only framework-driver implementation boundary | implemented by drivers, consumed by ArenaRunner |
| `DriverLookup` | Lookup port resolving a framework id to a driver | adapted by FrameworkDriverRegistry, consumed by ArenaRunner |
| `ReportPublisher` | Comparison-report publishing port | adapted by evaluation, consumed by ArenaRunner |

`CircuitBreaker` is not a contracts port. It is the stateful breaker primitive inside
`runtime`, with the time source injected at construction, and it is held per endpoint by
ArenaRunner.

### Data flow for one Arena request

```
Web → Next rewrite → transport (CORS and auth) → ArenaService.run()
  → ArenaRunner.streamParallel() → per-column workers
    → AgentDriver.run() → LLM stream → SSE events → Web
```

## Testing

```bash
pnpm test          # full Vitest suite
pnpm typecheck     # whole-repo typecheck; build packages first
pnpm -r build      # build every package, including Next.js
```

## Development

Requirements are Node.js >= 20.9 and pnpm. The workspace members are listed in
`pnpm-workspace.yaml`.

```bash
pnpm build         # build all packages
pnpm typecheck     # package typecheck and test typecheck
pnpm test          # Vitest suite
pnpm boundaries    # scripts/check-boundaries.mjs: dependency direction rules
pnpm check:deps    # scripts/check-package-deps.mjs: declared vs imported deps and value-edge cycles
pnpm dev:server    # Hono HTTP backend on 8281
pnpm dev:web       # Next.js frontend on 8280
pnpm start:server  # run the built backend
```

The web app carries its own gate, `pnpm --filter @agentprism/web check:i18n`: catalog key
parity between `en` and `zh-CN`, plus a CJK sweep over `src/app` and `src/components` so
user-visible copy never bypasses the catalogs.

### Repository layout

```
apps/<app>/                composition root (server) and frontend (web); see apps/README.md
packages/<family>/<leaf>/  two-level capability families; every leaf ships src/, tests/,
                           README.md, package.json, and tsconfig.json
tests/<journey>/           cross-domain journey tests through @agentprism/* public exports only
scripts/                   gates (boundaries, deps) and the evaluation matrix runner
docs/                      documentation tree; see docs/README.md for the map
```

Each package README states its responsibilities, seam surface, and dependency direction.
`docs/architecture.md` defines the capability families, dependency directions, and shared
vocabulary.

### Conventions

- Commits follow Conventional Commits with `feat`, `fix`, `docs`, `refactor`, `chore`,
  `test`, or `perf`, an imperative subject of at most 50 characters, and one concern per
  commit. Branches are `<type>/<kebab-case>`.
- Code and comments are English. Documentation ships in English with Simplified Chinese
  mirrors. User-visible UI copy lives in the i18n catalogs, with `en` canonical and
  `zh-CN` mirrored, and never inline.
- The sandbox assembles a deny-list policy by default that blocks irreversible filesystem
  commands in the agent execution chain. It is a guardrail, not a security boundary.
- Contributing starts at [CONTRIBUTING.md](CONTRIBUTING.md) (简体中文: [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)).
- For coding agents, follow [AGENTS.md](AGENTS.md).

## Package catalog

| Package | Responsibility |
|---|---|
| `contracts` | Zod enums and schemas, port interfaces, pure data types |
| `environment` | ScopedFileSystem and child-process runner |
| `persistence` | JSON atomic read and write |
| `config` | Settings, paths, and `.env` |
| `telemetry` | Token accounting and metrics |
| `runtime` | WorkspaceRegistry, Semaphore, CircuitBreaker, Clock |
| `context` | Standalone context capabilities: chunking, retrieval, mentions, time, analytics, budget, compaction, instructions |
| `tools` | Tool seam, built-in tools, MCP bridging, shared tool symbols |
| `harness` | Prompt building, context assembly, verification loop |
| `memory` | Cross-session memory: store, episodic and semantic layers, service port |
| `agent` | Single-column `runAgentExecution` lifecycle |
| `drivers` | Driver registry and seven loop-architecture backends |
| `dimensions` | Experiment dimension catalog and options |
| `evaluation` | Judging and comparison reports |
| `providers` | LLM provider config, endpoint catalog, model construction |
| `arena` | Dimension routing, parallel runner, breaker |
| `session` | Execution-session ledger with format, outline, projection, query, telemetry, and title leaves |
| `builder` | Conversational assembly service and turn execution |
| `sandbox` | Shell-command safety policy, deny-list by default |
| `application` | Use-case service layer |
| `transport` | Hono HTTP app with domain routes split by `route-*` leaves |
| `client` | Frontend API client |
| `arena-view` | Event-stream to presentational semantics: fold, trace, final answer |
| `ui` | Shared UI fragments |
