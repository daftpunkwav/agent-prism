# tools/

Model-callable tool registration and implementation. `tool-registry` is the implementation-free pure seam (registry + toolset resolution); `tool-builtins` assembles all builtin tools and implements them. `agent` and `builder` consume only the public surface of these two leaves; the `driver-langchain` bridge consumes only the `contracts` `ToolDefinition` type.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`tool-registry/`](tool-registry/README.md) | Tool seam: `MapToolRegistry` (implements `contracts.ToolRegistry`), toolset resolution (`normalizeToolset`, `selectToolNames`, `selectToolRegistry`) | Seam (zero tool implementations) |
| [`tool-builtins/`](tool-builtins/README.md) | Builtin tool implementations: `createBuiltinToolRegistry` (read/write/edit/ls/bash/apply-patch/glob/grep/web_fetch/todo_write/ask_user/web_search/run_job/bash_session/subagent/skill/goal/ralph_loop/plan/session_query/symbols/scatter) | Registered into `ToolRegistry` |
| [`tool-mcp/`](tool-mcp/README.md) | MCP attachment seam: in-process fs/fetch servers plus external JSON-RPC stdio bridging under `mcp__<server>__<tool>` names | Registered best-effort at the composition root |
| [`tool-symbols/`](tool-symbols/README.md) | Code symbol index tool (definitions/references/dependents) | Registered inside `tool-builtins` |
