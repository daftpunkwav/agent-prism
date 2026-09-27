# Built-in tools

Built-in tools live in `packages/tools/tool-builtins/src/definitions/` and are registered
by `createBuiltinToolRegistry()` in `src/builtins.ts`. A tool participates in a fixed set
of surfaces. Missing any surface is caught by the gates and tests listed here.

## Toolset membership

The tool name is added to `TOOL_NAMES_BY_TOOLSET` in
`packages/contracts/contracts/src/enums.ts`, which is the single source of truth for
which toolset carries which tool. Placement rules:

- Network-capability tools `web_fetch` and `web_search` belong only to `full`.
- Tools with mutation potential never enter `read_only`.
- Orchestration and read helpers `subagent`, `skill`, `ralph_loop`, `session_query`,
  `symbols`, and `scatter` are open on all three toolsets.

## Definition

A file `packages/tools/tool-builtins/src/definitions/<name>.ts` exports a `ToolDefinition`
from `contracts` with `name`, `description`, `jsonSchema`, `mutatesWorkspace`, optional
`timeoutMs`, and `execute()`, and is registered in `src/builtins.ts`.

- Input validation fails closed and throws on duplicates, empty values, or oversize
  input. Limits are exposed as `MAX_*` constants, as in `todo.ts` and `ask-user.ts`.
- Output is routed through the shared helpers: `truncate()` and `MAX_OUTPUT = 32 * 1024`
  live in `definitions/caps.ts`, while `boundText()` (which persists to the workspace
  `.spills/` directory before pruning) lives in `definitions/spill.ts`. See
  [../reference/tools.md](../reference/tools.md).
- `execute()` returns a structured `ToolExecutionResult` of `{result, fileDiff, ok, code?}`.
  `fileDiff` is emitted after successful write or edit work so the UI can render diffs.

## Execution-layer overrides

Tools whose live body needs injected ports, namely `subagent`, `ralph_loop`,
`session_query`, and `scatter`, register a placeholder definition that fails closed. The
execution layer in `@agentprism/agent` overrides by name with the live body. Discovery
surfaces such as the builder catalog, the LC bridge, and prompts stay bound to the
placeholder. Any port-dependent tool follows this split.

## Reporting surfaces

`packages/evaluation/evaluation/src/ablation.ts` matches event shapes such as the `mcp__*`
prefix and `subagent` or `ralph_loop` delegations. A tool that should count in ablation
rows is added there. Trace UI summary cases live in the web trace components.

## Tests

Leaf tests live in `packages/tools/tool-builtins/tests/`. Toolset authorization is
covered by the leaf tests as well (`packages/tools/tool-registry/tests/`,
`packages/tools/tool-builtins/tests/`, and `packages/harness/harness/tests/tool-guard.test.ts`).

## Documentation

The tool catalog in [../reference/tools.md](../reference/tools.md) gains a row for the
tool.

## Toolset resolution semantics

- `normalizeToolset`: unknown values fall back to `read_only`.
- `resolveToolsetId`: empty or unset resolves to `full`. Legacy aliases map `code_file`
  to `edit_run`, and `calc_time` or `workspace_read` to `read_only`.
- `MapToolRegistry` enforces `authorizedNames`. A tool not in the selected toolset
  returns `unauthorized_tool` and never executes.
- The `toolset` dimension must expose at least one option. The check runs at startup in
  `apps/server/src/assemble.ts`.
