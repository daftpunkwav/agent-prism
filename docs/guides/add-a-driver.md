# Framework drivers

A driver is a loop-architecture backend behind the `AgentDriver` port, which declares
`run(context): AsyncIterable<ArenaEvent>` in
`packages/contracts/contracts/src/agent-driver.ts`. The registered backends are `native`,
`plan_execute`, `self_critique`, `langchain`, `langgraph`, `deepagents`, `openai_agents`, `claude_agent_sdk`, `autogen`, and `crewai`, loaded
by `apps/server/src/load-drivers.ts`.

## Leaf placement

A driver leaf lives at `packages/drivers/driver-<name>/` and follows the leaf anatomy in
[../architecture/package-layout.md](../architecture/package-layout.md). Dependency rules
are enforced by `pnpm boundaries`:

- Allowed: `contracts`, `environment`, `runtime`, `telemetry`, `harness`, and
  `driver-run-support`.
- Never: providers, tool packages, arena, agent, or transport. Tool access goes through
  `contracts` types such as `ToolDefinition` only.
- External SDK dependencies such as `@langchain/*` live only in the leaf that needs them.
  `driver-langgraph` may also take `driver-langchain` for the shared LC bridging.

## Harness seams

Drivers reuse `buildSystemUser`, `applyContextPipeline`, and the shared event translation
from `driver-run-support`, so loop differences stay architectural rather than prompt
differences. Reasoning-mode behavior belongs in the driver's own control flow and is
graded in the reasoning support table described below.

## Event output

Drivers yield `ArenaEvent` values with the pipeline label. The runtime-side `stampEvent`
backfills a missing `turn` field, but events with wrong turn data corrupt turn filtering
and answer extraction, so fields are set accurately by the driver. Reasoning and planner
deliberation ride `reflect` events so answer extraction, which reads the last thought or
else the last observation, stays unpolluted.

## Banner and support table

Driver banners join the `PIPELINE_BANNER_PREFIX` single source, and the
`driver-banner-consistency` test locks banners across backends. Capability suffixes stay
reproducible column to column. The reasoning support table in `driver-run-support` grades
each driver as structural, budget, prompt, or skeleton per reasoning mode.

## Registration

The loader is added to `builtinDriverLoaders` in `apps/server/src/load-drivers.ts`.
Registration is best-effort, so a failing backend only warns, and the composition smoke
test `apps/server/tests/load-drivers.test.ts` pins the loader table contents. The
`framework` dimension options are runtime-synced from the driver registry through
`DimensionCatalog.syncCapabilityOptions`, and the web reads them from `/api/arena/meta`,
so no hardcoded frontend list is needed.

## Constraints

- Drivers never construct models themselves. The column model arrives through the
  injected `ColumnRuntimeFactory`, implemented by
  `provider-langchain.createColumnRuntime`.
- Framework built-ins never replace the arena tool surface. A framework that executes
  tools itself is wired so writes flow through `tools.execute` (Claude Code built-ins off,
  its filesystem tools read-only; deepagents reserves `ls`/`glob`/`grep`, so the registry
  tools with those names are dropped for that column). Otherwise a column bypasses its
  toolset policy and stops being comparable.
- Provider usage must reach the tracker. Backends that stream through `LlmAdapter` record
  the usage part the adapter emits last; without it the column reports a prompt estimate
  as if it were real tokens.
- Cancellation propagates. Drivers honor the context abort signal, following the subagent
  abort rethrow semantics.
- A failing driver registration only warns, but an empty registry fails startup.

## Dual-runtime drivers

`autogen` and `crewai` run on two interchangeable backends selected per column run:
a real framework bridge (a Python bootstrap process that talks to the host over
NDJSON — model completions and tool executions round-trip to the arena model port
and tool registry) and a TypeScript pattern fallback. Selection probes the
interpreter and framework package; `ARENA_AUTOGEN_RUNTIME` / `ARENA_CREWAI_RUNTIME`
force a side (`python` fails closed, `ts` skips the probe, `auto` is the default).
See the two driver READMEs for the protocol and setup steps.
