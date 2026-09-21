# Tools

Sources of truth: toolset membership in `TOOL_NAMES_BY_TOOLSET` in
`packages/contracts/contracts/src/enums.ts`, definitions in
`packages/tools/tool-builtins/src/definitions/`, and the registry in
`packages/tools/tool-registry/src/`. When this page and the code disagree, the code wins.

## Toolsets

| Toolset | Tools, 22 / 19 / 10 |
|---|---|
| `full` | read, write, edit, ls, run, apply_patch, glob, grep, webfetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter |
| `edit_run` | `full` minus `ls`, `webfetch`, and `web_search`, keeping glob and grep |
| `read_only` | read, ls, glob, grep, subagent, skill, ralph_loop, session_query, symbols, scatter |

Resolution semantics in `tool-registry/src/toolset.ts`: an unknown toolset resolves to
`read_only`; an empty or unset toolset resolves to `full`; legacy aliases map `code_file`
to `edit_run` and `calc_time` or `workspace_read` to `read_only`.

## Built-in tools

| Tool | Purpose and caps | Toolsets |
|---|---|---|
| `read` | file read with 1-based `offset` and `limit`; output cap 256 KB; bare truncation only, because it is the spill retrieval path | all |
| `write` | create or overwrite; refuses content over 256 K characters rather than truncating | full, edit_run |
| `edit` | exact `old_text` to `new_text` replace; `new_text` over 256 K characters is refused | full, edit_run |
| `ls` | listing, or the full workspace tree with an empty path and recursive | all |
| `run` | shell in the workspace cwd; timeout clamped to 1 to 120 seconds with a default of 30; PowerShell 5.1 on Windows; long output spilled | full, edit_run |
| `apply_patch` | V4A multi-file patch with `*** Begin Patch` and Add, Update, Delete, and Move-to directives; not atomic, so earlier hunks persist | full, edit_run |
| `glob` | glob search with `**`, `*`, `?`, `[abc]`, and `{a,b}` | all |
| `grep` | regex content search returning `path:line: text`; at most 200 match lines; per-line window of 20 000 characters | all |
| `webfetch` | http or https to readable text; 15-second timeout; body capped at 512 KB before HTML stripping | full |
| `todo_write` | whole-list replace plan list; 50 items of 500 characters; persists `.agent-todos.json` | full, edit_run |
| `ask_user` | records questions to `.agent-questions.json`, at most 5 per call and 50 stored; never blocks and instructs the model to continue | full, edit_run |
| `web_search` | Exa or Tavily through `SEARCH_PROVIDER` and `SEARCH_API_KEY`; unconfigured fails closed with a setup hint; 15-second timeout; 1 to 10 results with a default of 5 | full |
| `run_job` | background jobs with `start`, `poll`, `kill`, and `list`; 8 live jobs per workspace; poll returns the delta only; output over 32 K spills to `.spills/*.log`; process-scoped, so orphans appear after restart | full, edit_run |
| `bash_session` | one persistent POSIX shell per workspace, so `cd` and `export` survive; sentinel-delimited frames; Windows fails closed toward `run` and `run_job` | full, edit_run |
| `subagent` | nested delegation with `spawn` for a blank history or `fork` for the parent transcript; child steps default to 8 within 1 to 10; depth cap 1; tokens fold into the parent | all |
| `skill` | `list` and `read` runbooks from the bundled set, the global user directory (`data/skills/`), and workspace `.skills/<name>/SKILL.md` overrides (workspace wins over user over bundled); names disabled in settings are filtered out; kebab-case names | all |
| `goal` | one durable objective in `.agent-goal.json`; statuses `active`, `paused`, `blocked`, `completed`; a block requires a reason | full, edit_run |
| `ralph_loop` | fixed-round loop; rounds default to 3 within 1 to 8; reads a `STATUS:` line and passes the rest through with a 4 000-character cap | all |
| `plan` | propose-and-record document `.agent-plan.md` that must start with `#`; at most 8 000 characters; records and never submits | full, edit_run |
| `session_query` | read-only ledger queries `list`, `read`, and `read_entry`; limit defaults to 10 with a hard cap of 50; `read_entry` pages spilled blob text by lines | all |
| `symbols` | code navigation with `defs`, `refs`, `search`, and `dependents` from `@agentprism/tool-symbols` | all |
| `scatter` | fan-out placeholder: 2 to 8 subtasks, per-child steps 1 to 10, concurrency 3, and `concat` or `vote` strategies | all |

Placeholder pattern: `subagent`, `ralph_loop`, `session_query`, and `scatter` register
placeholders here that fail closed. The live bodies live in `@agentprism/agent`, which
overrides by name at execution, or bind an injected port such as `SessionQueryPort`.

## Execution mechanics in `MapToolRegistry`

- Authorization: only names selected for the column's toolset execute. Everything else
  returns `unauthorized_tool`.
- `beforeExecute` and `afterExecute` hooks: the sandbox deny policy rides `beforeExecute`
  and its catastrophic shape is not overridable. The repeat-call reminder rides
  `afterExecute` from `harness/control/repeat-reminder.ts`, is suggestive only, and never
  vetoes, with thresholds `[3, 5, 8]`.
- Timeouts are cooperative deadlines that produce a structured `timeout` outcome.
- Result codes: `unknown_tool`, `unauthorized_tool`, `workspace_error`, `aborted`, and
  `timeout`.

## Output-budget helpers in `tool-builtins/src/definitions/`

| Helper | Thresholds | Behavior |
|---|---|---|
| `truncate` in `helpers.ts` | `MAX_OUTPUT` 32 K characters and `MAX_FILE` 256 K | middle-prune, keeping head and tail where `tail <= min(4096, max/5)`, with the marker `…[middle pruned: ~N tokens total]…` using the char-proxy estimate from contracts `CHARS_PER_TOKEN` |
| `boundText` and spill in `spill.ts` | spill at 32 KiB UTF-8; per-file cap 512 K characters; 20 files kept with the oldest `spill-*.txt` evicted | full text to `.spills/spill-NNNNNN-<tool>.txt`; the model sees a locator and preview; a dump failure degrades to a loud truncation rather than an error |

## MCP tools in `packages/tools/tool-mcp`

- In-process servers with the `mcp__` prefix: `mcp__fs_list` with 200 entries and 8 K
  characters of output, `mcp__fs_read` with a 16 KB cap and head and tail pruning, and
  `mcp__fetch_url` for http or https only with a default of 8 000 characters and a cap of
  16 000.
- Policy to tools: `off` mounts none; `fs` mounts `fs_list` and `fs_read`; `full` adds
  `fetch_url`, which is `full`-toolset only like webfetch and web_search.
- Remote stdio servers come from the `MCP_SERVERS` env var, a JSON array of
  `{command, args?, env?, timeoutMs?, tools?}` where per-server `timeoutMs` defaults to
  30 000 ms. Tools are namespaced `mcp__<server>__<tool>` and mounted best-effort on arena
  top-level columns only. Dead servers warn and are skipped, nested turns never inherit
  processes, and `read_only` columns never mount remote.
