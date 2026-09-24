# `@agentprism/tool-builtins`

Builtin tool implementations. `createBuiltinToolRegistry()` registers twenty-two tool definitions: read, write, edit, ls, bash, apply_patch, glob, grep, web_fetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, and scatter. Filesystem and child-process access runs under `ScopedFileSystem` and `runProcess`. `workspace-view` is a shared view helper used by the definitions and is not a registered tool.

## Dependencies

- Runtime: `contracts / environment / tool-registry / tool-symbols`.
