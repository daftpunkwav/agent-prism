# Operations runbook

Day-to-day operation of the local stack, grounded in the startup and shutdown code in
`apps/server/src/server.ts`, `portcheck.ts`, and `lifecycle.ts`, and in
`apps/web/scripts/dev.mjs`.

## Ports and processes

| Concern | Value | Notes |
|---|---|---|
| Backend | `BACKEND_HOST:BACKEND_PORT`, default `127.0.0.1:8281` | If the port is taken or out of range, startup throws `InvalidPortError` or `PortInUseError`, which the host entry logs before `exit(1)`. There is no fallback port. |
| Frontend dev | `http://localhost:8280` | `apps/web/scripts/dev.mjs` probes the port with a bind and connect double probe and accepts `-p` or `--port`. |
| Frontend start | `next start -p 8280` | production mode |
| Health | `GET /api/health` and `GET /health` | always unauthenticated |
| Shutdown | SIGINT or SIGTERM, graceful with a 5-second timeout, then forced `exit(1)` | closes idle connections first |

## Run modes

```bash
pnpm -r build      # build every package including both apps
pnpm dev:server   # predev builds, then node --watch dist/main.js; rebuild the server to reload
pnpm start:server # prestart builds, then node dist/main.js; run the built backend
pnpm dev:web       # next dev through the launcher
```

`dev:server` watches compiled output. Edit, run `pnpm -r build` or build just the touched
packages, and the watcher restarts. There is no tsx or ts-node in the chain.

## Matrix evaluation run

```bash
# terminal 1: configured provider and running server
pnpm dev:server
# terminal 2:
node scripts/run-matrix.mjs [--base http://localhost:8281] [--out matrix.md]
                            [--templates id1,id2] [--timeout-ms 600000]
```

The script reads `GET /api/arena/templates` for scored templates unless narrowed, streams
`POST /api/arena/matrix`, and prints a markdown scoreboard with the per-template score,
tokens, tools, and per-column verdicts. Cells spend real model calls.

## Storage

The full layout table is in [../reference/configuration.md](../reference/configuration.md).
Operational notes:

- All state is crash-safe by construction: atomic writes with `.tmp` files and renames in
  a per-path queue, plus `.bak` recovery. A corrupt provider file falls back to the `.env`
  seed. A corrupt session record is contained rather than fatal.
- Sessions left `active` by a killed process flip to `failed` on the next load.
- Oversized ledger entries live in `data/sessions.json.blobs/`. Deleting a session purges
  its blobs.
- Workspaces under `data/runs/<runId>/<workspace>/` are rehydrated after restart, capped
  by `MAX_WORKSPACES` (default 32) with a `WORKSPACE_TTL_SECONDS` idle lifetime (default
  3600) and LRU eviction. In-run workspaces are protected.
- To reset, stop the stack and remove `data/`. All state is regenerable, and you lose
  sessions, projects, and provider config.

## Failure modes

| Situation | Behavior |
|---|---|
| Backend port busy or out of range | the host entry logs the typed error and exits 1, with no fallback |
| Non-loopback bind with empty `API_TOKEN` | startup refuses; loopback with an empty token only warns |
| Malformed `MCP_SERVERS` | warns once with `[assemble] MCP_SERVERS ignored`, and startup continues without MCP |
| Zero drivers registered | startup fails fast |
| Capability dimension with zero options | startup fails fast for `prompt`, `reasoning`, `context`, `harness`, or `toolset` |
| Unconfigured `web_search` | the tool fails closed with setup guidance |
| Ledger write pathology, such as a full disk or a reached cap | warns, and the observed run continues |
| SSE through the Next proxy | requires `compress: false`, already set in `next.config.ts`; without it streams buffer until completion |

## Debugging aids

- LLM wire traces: builder turns record `llm_request`, `llm_response`, and `llm_error`
  trace entries, visible in the builder trace panel.
- Session forensics: `GET /api/sessions/:id/export` downloads the full record and entry
  envelope.
- Spill forensics: oversized tool outputs land verbatim under the workspace `.spills/`
  directory with a numbered locator in the model-visible preview.
- `scripts/run-matrix.mjs --out matrix.md` produces a comparable artifact for regression
  review across provider and driver changes.
