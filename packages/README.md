# packages/

Everything under `packages/` is organized two levels deep: `<family>/<leaf>/`. A family
directory groups related leaves and carries a role-table `README.md`; every leaf is an
actual workspace package (`@agentprism/<leaf>`, glob `packages/*/*` in
`pnpm-workspace.yaml`) shipping `src/ tests/ README.md package.json tsconfig.json`.

Dependency directions between families are fixed by `pnpm boundaries` and
`pnpm check:deps`; the full map (family roles, seam surfaces, iron rules) lives in
[docs/architecture.md](../docs/architecture.md). Test placement follows
[tests/README.md](../tests/README.md).

## Families

| Family | Leaves | Role |
|---|---|---|
| [`contracts/`](contracts/README.md) | contracts | Repo-wide vocabulary and port layer: Zod enums/schemas, event contracts, port interfaces; the zero-dep leaf everything depends on |
| [`environment/`](environment/README.md) | environment | Sandboxed filesystem (`ScopedFileSystem`) and child-process runner |
| [`persistence/`](persistence/README.md) | persistence | JSON atomic read/write (`AtomicJsonFile`) |
| [`config/`](config/README.md) | config | Settings / paths / `.env` loading |
| [`telemetry/`](telemetry/README.md) | telemetry | Token accounting and metrics |
| [`runtime/`](runtime/README.md) | runtime | WorkspaceRegistry, Semaphore, CircuitBreaker, Clock |
| [`context/`](context/README.md) | chunking, retrieval, mentions, time + analytics, budget, compaction, instructions | Standalone context capabilities for prompts and retrieval (first four wired into harness) |
| [`tools/`](tools/README.md) | tool-registry, tool-builtins, tool-mcp, tool-symbols | Tool seam, built-in tools, MCP bridging, shared tool symbols |
| [`harness/`](harness/README.md) | harness | Neutral execution semantics: prompt assembly, context pipeline, reasoning modes, verification loop |
| [`memory/`](memory/README.md) | memory-store, memory-episodic, memory-semantic, memory-service | Cross-session memory: atomic store plus search index, episodic and semantic layers, and the service port adapter |
| [`agent/`](agent/README.md) | agent | Single-column execution lifecycle |
| [`drivers/`](drivers/README.md) | driver-run-support, driver-native, driver-langchain, driver-langgraph, driver-plan-execute, driver-self-critique, driver-autogen, driver-crewai | Shared driver run-support kit and seven loop-architecture backends |
| [`dimensions/`](dimensions/README.md) | dimensions | Experiment dimension catalog and options |
| [`evaluation/`](evaluation/README.md) | evaluation | Judging, comparison reports, ablation rows, matrix aggregation |
| [`providers/`](providers/README.md) | provider-catalog, provider-langchain | Provider seam (catalog/config/lookup) and LangChain SDK model construction |
| [`arena/`](arena/README.md) | arena-dimensions, arena-runner | Dimension routing + baselines, parallel multi-column runner |
| [`session/`](session/README.md) | session, session-persistence, session-format, session-outline, session-projection, session-query, session-telemetry, session-title | Execution-session ledger: stores plus format, outline, projection, query, telemetry, title leaves |
| [`builder/`](builder/README.md) | builder-service, builder-turns | Conversational assembly service and turn execution |
| [`sandbox/`](sandbox/README.md) | sandbox | Shell-command safety policy (deny-list by default) |
| [`application/`](application/README.md) | application | Use-case service layer (ArenaService, SessionService, …) |
| [`transport/`](transport/README.md) | http-runtime, route-arena, route-builder, route-projects, route-provider, route-sessions, route-settings, route-threads, route-workspace | Hono HTTP shell and domain route leaves |
| [`client/`](client/README.md) | client | Frontend HTTP/SSE API client |
| [`arena-view/`](arena-view/README.md) | arena-view | Event-stream → view projections (fold, trace, final answer) |
| [`ui/`](ui/README.md) | ui | Shared UI fragments |

The table order mirrors the layer diagram in the root [README](../README.md): leaf
vocabulary and infrastructure at the top, execution semantics in the middle, protocol
and view concerns at the bottom.
