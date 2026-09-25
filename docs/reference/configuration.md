# Configuration

Settings load once at startup through `loadSettings()` in
`packages/config/config/src/settings.ts`. The repo-root `.env` file, defined by
`ENV_FILE` in `packages/config/config/src/paths.ts`, is merged with `process.env`, and
process env wins. Numbers must be full-string integers or decimals and pass range checks.
A violation fails fast with `SettingsLoadError`, and the process refuses to start on a
bad value.

Every tunable below follows the same shape: a `Settings` field with a range check,
injected at the composition root in `apps/server/src/assemble.ts` into the owning
component as a plain number option. An absent key keeps the built-in default, so
out-of-box behavior equals the default column.

## HTTP and auth

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_HOST` | `127.0.0.1` | bind address; a non-loopback value requires `API_TOKEN` and fails fast in `assemble.ts` |
| `BACKEND_PORT` | `8281` | HTTP listen port; must be free at startup, with no fallback |
| `FRONTEND_PORT` | `8280` | feeds only the CORS origin allowlist |
| `CORS_ORIGINS` | `""` | extra allowed origins, comma-separated; a wildcard `*` is rejected |
| `API_TOKEN` | `""` | empty means unauthenticated; otherwise `Authorization: Bearer …` or `X-API-Token` |
| `MAX_REQUEST_SIZE` | 10 MiB | request body cap from 1 KiB to 1 GiB |

## LLM seed and model calls

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER_NAME` | `StepFun` | provider-store seed, used only when `data/provider_config.json` is missing or corrupt |
| `LLM_API_KEY` | `""` | seed API key |
| `LLM_BASE_URL` | `https://api.stepfun.com/step_plan` | seed base URL |
| `LLM_MODEL` | `step-3.7-flash` | seed model |
| `LLM_API_FORMAT` | `anthropic_messages` | `anthropic_messages`, `openai_chat`, or `openai_responses` |
| `LLM_TEMPERATURE` | `0.0` | 0 to 2 |
| `LLM_TIMEOUT_MS` | `120000` | per-call chat-model timeout, applied to column models, judge, narrative, and builder |
| `LLM_MAX_RETRIES` | `2`, range 0 to 5 | SDK-level transient-failure retry count for chat models |
| `LLM_RETRY_DELAY_MS` | `500`, range 0 to 10 000 | parsed but currently unused: retries ride the chat-model SDK (`LLM_MAX_RETRIES`), which manages its own backoff; kept for compatibility |

## Concurrency, breakers, and interaction

| Variable | Default | Purpose |
|---|---|---|
| `MAX_CONCURRENT_RUNS` | `4`, range 1 to 64 | parallel arena runs |
| `MAX_CONCURRENT_COLUMNS` | `8`, range 1 to 16 | column fan-out within one run |
| `BREAKER_THRESHOLD` | `3`, range 1 to 10 | consecutive endpoint failures before the breaker trips |
| `BREAKER_COOLDOWN_MS` | `30000`, range 1 000 to 300 000 | breaker half-open cooldown |
| `ASK_USER_WAIT_MS` | `300000`, range 10 000 to 600 000 | ask_user wait before degrading to headless defer |

## Agent threads

| Variable | Default | Purpose |
|---|---|---|
| `MAX_THREADS` | `24`, range 1 to 256 | thread registry ceiling, which must be below `MAX_WORKSPACES` as a fail-fast cross-check |
| `THREAD_MAX_HISTORY_MESSAGES` | `60`, range 2 to 1 000 | persisted transcript cap in messages, counted as user and assistant pairs |
| `THREAD_MAX_HISTORY_CHARS` | `96000`, range 64 000 to 2 000 000 | persisted transcript character cap; the floor is twice the per-message clamp so the newest turn survives |
| `THREAD_ANSWER_TAIL_CHARS` | `2000`, range 200 to 100 000 | event tail retained while extracting a turn's answer |

## Workspaces and stores

| Variable | Default | Purpose |
|---|---|---|
| `MAX_WORKSPACES` | `32`, range 1 to 256 | workspace registry quota; every thread can pin one workspace |
| `WORKSPACE_TTL_SECONDS` | `3600`, range 60 to 86 400 | idle lifetime before TTL eviction |
| `WORKSPACE_LRU_WINDOW_SECONDS` | `300`, range 30 to 86 400 | idle window beyond which LRU eviction prefers a workspace |
| `FILE_FLUSH_DEBOUNCE_MS` | `300`, range 50 to 10 000 | write-coalescing window for `threads.json` and `builder_sessions.json` |
| `PROJECT_MAX_COUNT` | `50`, range 1 to 1 000 | project archive quota |
| `PROJECT_SNAPSHOT_MAX_CHARS` | `2000000`, range 100 000 to 20 000 000 | per-project workspace-snapshot cap |

## Context strategies

These are per-LLM-call budgets injected into every column run as `ContextTuning`, and the
strategies read the tuned values per call. Defaults are calibrated for English. CJK-heavy
content wants a lower `CONTEXT_CHARS_PER_TOKEN`.

| Variable | Default | Purpose |
|---|---|---|
| `CONTEXT_WINDOW_MESSAGES` | `12`, range 1 to 200 | message window for sliding, tool_tail, and summary overflow |
| `CONTEXT_CHARS_PER_TOKEN` | `4`, range 1 to 16 | char-proxy token estimate divisor |
| `CONTEXT_SUMMARY_MAX_CHARS` | `4000`, range 500 to 100 000 | cap for the summary strategy overflow digest |
| `CONTEXT_TOKEN_BUDGET_CHARS` | `24000`, range 1 000 to 1 000 000 | character budget for the token_budget strategy |
| `CONTEXT_TOKEN_BUDGET_KEEP_TURNS` | `6`, range 0 to 100 | newest messages token_budget never sacrifices |
| `CONTEXT_TOOL_TAIL_BUDGET_CHARS` | `4000`, range 500 to 100 000 | per-tool-result prune budget for tool_tail |
| `CONTEXT_TOOL_TAIL_KEEP_CHARS` | `1200`, range 100 to 50 000 | tail characters tool_tail keeps verbatim, covering errors and conclusions |
| `CONTEXT_BUDGET_TOKENS` | `6000`, range 500 to 200 000 | token pool for the budget strategy |
| `CONTEXT_CHECKPOINT_TARGET_TOKENS` | `2000`, range 200 to 100 000 | overflow target that triggers checkpoint compaction |

## Builtin tool caps and timeouts

| Variable | Default | Purpose |
|---|---|---|
| `TOOL_OUTPUT_MAX_CHARS` | `32768`, range 4 096 to 1 048 576 | tool-result cap before truncation |
| `TOOL_FILE_MAX_CHARS` | `262144`, range 4 096 to 4 194 304 | single read, write, or edit file cap |
| `TOOL_RUN_TIMEOUT_DEFAULT_S` | `30`, range 1 to 600 | run and bash timeout when the model omits it |
| `TOOL_RUN_TIMEOUT_MAX_S` | `120`, range 1 to 3 600 | upper clamp for model-supplied timeouts, which must be at least the default as a fail-fast check |
| `WEB_FETCH_TIMEOUT_MS` | `15000`, range 1 000 to 300 000 | web_fetch HTTP timeout |
| `WEB_SEARCH_TIMEOUT_MS` | `15000`, range 1 000 to 300 000 | web_search HTTP timeout |
| `MCP_REQUEST_TIMEOUT_MS` | `30000`, range 1 000 to 600 000 | default per-request MCP timeout, overridden by the per-server `timeoutMs` in `MCP_SERVERS` |
| `MCP_FETCH_TIMEOUT_MS` | `15000`, range 1 000 to 300 000 | mcp_fetch per-fetch timeout |
| `TOOL_SUBAGENT_MAX_STEPS` | `10`, range 1 to 40 | upper clamp for model-supplied subagent step budgets |
| `TOOL_RALPH_MAX_ROUNDS` | `8`, range 1 to 64 | upper clamp for model-supplied ralph loop rounds |
| `AGENT_MAX_DELEGATION_DEPTH` | `1`, range 1 to 3 | subagent nesting ceiling, meaning parent to child only |

## Runs, streams, and server

| Variable | Default | Purpose |
|---|---|---|
| `ARENA_EVENT_RETENTION` | `5000`, range 500 to 100 000 | per-pipeline events retained for the comparison report |
| `ARENA_DISCONNECT_GRACE_MS` | `5000`, range 500 to 60 000 | teardown wait after a client disconnect |
| `SSE_HEARTBEAT_MS` | `15000`, range 1 000 to 60 000 | SSE comment-ping interval on run, matrix, chat, and thread streams, which keeps proxies from dropping quiet connections |
| `SERVER_SHUTDOWN_GRACE_MS` | `5000`, range 500 to 60 000 | watchdog before a hanging graceful shutdown forces exit |

## Kept as code

These are deliberately not env-tunable.

- Contract wire caps: arena history of 24 000 characters, message of 4 000, messages
  array of 24, attachments of 5 times 64 KiB, endpoint count of 12, and similar. These
  bound the browser-to-server protocol, and both ends must agree. A future path is
  serving effective caps through the `GET /api/arena/meta` discovery endpoint, following
  the precedent of `min_select` and baseline field ranges. The server-side thread caps
  above are env-tunable.
- Driver algorithm internals: reflexion rounds, critic redirect score, replan budgets,
  and quiet-turn thresholds. These are algorithm identity rather than deployment knobs,
  so they stay pinned per framework.
- Verification-loop retry budgets: the harness prompt copy states the allowance of at
  most 2 retries, and making it tunable would desync the prompt from the behavior.
- UI display numbers such as truncation lengths, toast durations, and poll intervals,
  safety floors such as sandbox command analysis and path rules, and token-window
  fallbacks of `context_window` 128 000, `max_input_tokens` 120 000, and
  `max_output_tokens` 96 000. The token windows are configurable per endpoint in Provider
  settings, and the constants are only defaults for omitted fields.

## Variables read outside the config loader

| Variable | Read by | Purpose |
|---|---|---|
| `MCP_SERVERS` | `apps/server/src/assemble.ts` to `tool-mcp/src/config.ts` | JSON array of stdio MCP servers `{command, args?, env?, timeoutMs?, tools?, name?, enabled?}`; `timeoutMs` defaults to `MCP_REQUEST_TIMEOUT_MS`; it seeds the managed store (`data/mcp_servers.json`) only while that file does not exist yet — once an operator saves through the settings API the file wins; malformed env JSON warns once and is ignored, and startup continues |
| `DRIVERS` | `apps/server/src/load-drivers.ts` | optional comma-separated driver allowlist, case-insensitive, such as `native,plan_execute,self_critique`; unset or blank means all builtins; unknown names warn and are ignored |
| `SEARCH_PROVIDER` | `tool-builtins/src/definitions/web-search.ts` | `exa` or `tavily`; anything else fails closed with a setup hint |
| `SEARCH_API_KEY` | same | provider key; missing fails closed |
| `SEARCH_API_URL` | same | endpoint override for tests, defaulting to Exa at `https://api.exa.ai/search` and Tavily at `https://api.tavily.com/search` |
| `NEXT_PUBLIC_API_BASE` | `packages/client/client/src/http.ts` | prefix for all client URLs; a same-origin proxy needs nothing |
| `ARENA_BASE` | `scripts/run-matrix.mjs` | base URL of a running server, default `http://localhost:8281` |
| `ARENA_TOT_WIDTH` | `driver-run-support/src/reasoning-constants.ts` (`totWidth`), consumed by the native, langgraph, and plan-execute drivers | ToT branch width, clamped 2 to 5, default 3; inside the server the runtime knob wins — `assemble.ts` seeds this variable from the effective knob at boot and on every knobs hot-apply |
| `ARENA_SELF_CONSISTENCY_N` | same helper (`selfConsistencyAttempts`) | self-consistency attempt count, clamped 2 to 9, default 5; model calls scale with it; same seeding precedence |
| `ARENA_CREWAI_PROCESS` | `driver-crewai/src/crew.ts` and `driver-crewai/python/bootstrap.py` | `hierarchical` switches the crew to the manager process, anything else keeps `sequential`; same seeding precedence |
| `ARENA_PYTHON` | `driver-run-support/src/python-probe.ts` | interpreter override for the framework runtime probes; unset or blank falls back to `python`, then `python3` |
| `ARENA_AUTOGEN_RUNTIME` | `driver-autogen/src/autogen-driver.ts` | `python` forces the real `autogen-agentchat` bridge (fails closed when the probe finds no interpreter with the package), `ts` forces the TypeScript pattern fallback, anything else is `auto` |
| `ARENA_CREWAI_RUNTIME` | `driver-crewai/src/crewai-driver.ts` | same contract as `ARENA_AUTOGEN_RUNTIME` for the `crewai` bridge |

## Runtime knobs

`data/runtime_knobs.json` holds operator overrides of the environment defaults for context
tuning, harness retry budgets, tool budgets, and driver knobs. `RuntimeKnobsStore` loads
them at startup and hot-applies updates through `GET` and `PUT /api/settings/knobs`, so a
settings save takes effect without a restart. An absent file keeps the environment
defaults.

## Skill and MCP management

The settings page also exposes two managed stores, both hot-applied without a restart.
`GET/POST /api/settings/skills`, `PUT/DELETE /api/settings/skills/:name`, and
`PUT /api/settings/skills/:name/enabled` manage the skill catalog: bundled skills are
read-only (writes reject with 409), user skills live in `data/skills/<name>/SKILL.md`,
and the disabled-name list persists in `data/skill_settings.json` and filters the
effective catalog from the next turn on. `GET` and `PUT /api/settings/mcp` replace the
whole managed MCP server list; the store keeps a shared in-memory array that per-run
consumers read, so a save reaches the next run immediately.

## Credential references

Provider endpoints stored through the settings API may hold an API key that is exactly
`"${env:NAME}"`. `resolveCredentialReference` in `provider-catalog/src/endpoints.ts`
resolves it at the single consumption point where models are constructed. The stored
value stays a reference, resolved secrets are never written back, and a missing variable
resolves to `""`, which then fails closed at model construction. There is no partial
interpolation.

## Persistence layout

Paths are defined in `config/src/paths.ts`.

| Path | Content | Recovery behavior |
|---|---|---|
| `data/provider_config.json` and `.bak` | provider endpoints and settings | a corrupt main file recovers from `.bak`; if still unusable, the `LLM_*` env seed applies |
| `data/sessions.json` and `.bak` | session ledger `{version:1, sessions:[…]}` | a corrupt main file recovers from `.bak`; stale `active` rows flip to `failed` on load |
| `data/sessions.json.blobs/` | oversized ledger entry texts named `<sessionId>.<seq>.blob.txt`, each at most 128 K characters | per-session purge on delete |
| `data/builder_sessions.json` and `.bak` | builder session store | atomic-write `.bak` recovery |
| `data/threads.json` and `.bak` | durable agent threads `{version:1, threads:[…]}` with transcript, pinned config, and workspace link | atomic-write `.bak` recovery, per-item corruption containment, and stale `running` reset to idle on load |
| `data/projects.json` | archived projects | atomic-write `.bak` recovery |
| `data/memory_episodic.json` | episodic memory entries | atomic-write `.bak` recovery |
| `data/memory_semantic.json` | semantic memory facts | atomic-write `.bak` recovery |
| `data/runtime_knobs.json` | file-backed runtime knob overrides | atomic-write `.bak` recovery |
| `data/mcp_servers.json` | managed MCP server list (settings API) | a corrupt file warns with `[mcp-store]` and startup falls back to the `MCP_SERVERS` env seed, leaving the file untouched |
| `data/skill_settings.json` | disabled skill names (settings API) | read failure degrades to "all skills enabled" |
| `data/skills/<name>/SKILL.md` | operator-created user skills | deleted skills drop their folder; malformed files are skipped during discovery |
| `data/runs/<runId>/<workspace>/` | per-column scratch workspaces | rehydrated after restart with `MAX_WORKSPACES` as the cap, `WORKSPACE_TTL_SECONDS` as the TTL, and LRU eviction with in-run protection |
| `data/runs/…/.spills/` | tool-result and job output dumps named `spill-*.txt` and `NNNNNN-<jobId>.log` | 20-file rotation |

All JSON writes are atomic through `@agentprism/persistence`, using `.tmp` files,
renames, a per-path write queue, and a `.bak` copy. A corrupted single session record is
contained rather than losing the store.

## Frontend configuration

`apps/web/next.config.ts` rewrites `/api/*` to `http://127.0.0.1:<BACKEND_PORT>` in dev,
resolving env, then root `.env`, then the default 8281. `compress: false` is required for
SSE because gzip buffering holds the stream until completion. Security headers include a
CSP whose `connect-src` is `'self' ws: wss:`, so a direct cross-origin API mode requires
adding the backend origin there explicitly.
