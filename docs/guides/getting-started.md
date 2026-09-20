# Getting started

## Prerequisites

- Node.js >= 20.9, from `engines` in `package.json`.
- pnpm, workspace-managed. The `pnpm-workspace.yaml` globs are `apps/*` and
  `packages/*/*`.
- A configured LLM provider before any real run. The backend starts without one, and runs
  fail at model construction.

## Install and build

```bash
pnpm install
pnpm -r build
```

`@agentprism/server`'s dev script runs `predev` with `tsc`, then
`node --watch dist/main.js`, so it watches compiled output. Rebuild after backend code
changes and the watcher restarts.

## Configure a provider

Either:

1. Settings UI. Start both servers, open `http://localhost:8280/settings`, and save
   endpoints. Config is stored at `data/provider_config.json`. API keys may be
   full-value references such as `"${env:MY_KEY}"`, resolved at use time and never
   written back resolved.
2. `.env` seed. Set `LLM_*` variables in the repo-root `.env`. They seed the provider
   store only when `provider_config.json` is missing or corrupt.

Every variable is listed in
[../reference/configuration.md](../reference/configuration.md).

## Run

```bash
pnpm dev:server     # Hono HTTP backend  → http://127.0.0.1:8281
pnpm dev:web         # Next.js frontend   → http://localhost:8280
```

Health probe: `curl http://127.0.0.1:8281/api/health` returns
`{"status":"ok","service":"arena"}`.

Ports come from settings. `BACKEND_PORT` defaults to 8281 and `FRONTEND_PORT` to 8280.
The web dev launcher probes its port and accepts `-p` to override, as in
`node scripts/dev.mjs -p 3000`. `CORS_ORIGINS` may add allowed origins; a wildcard `*` is
rejected at settings load.

## First comparison

1. Open `http://localhost:8280/arena`, enter a question, pick a dimension and at least
   two per-column selections, and run.
2. The stream is SSE on `POST /api/arena/run` with event name `"arena"`. Columns fold
   live through `@agentprism/arena-view`.
3. Judge the answers with a deterministic judge spec, or save the run as a project.
4. For a scored batch run, use `node scripts/run-matrix.mjs`. It needs a running runtime
   and a configured provider, and each cell spends real model calls.

## Verification

```bash
pnpm test            # full vitest suite
pnpm typecheck       # package typecheck and test typecheck
pnpm boundaries      # dependency direction gate
pnpm check:deps      # declaration honesty and value-edge cycles
```

## Data location

Everything persists under `data/`: `provider_config.json`, `sessions.json` with
`data/sessions.json.blobs/`, `builder_sessions.json`, `projects.json`, and
`data/runs/<runId>/<workspace>/` scratch workspaces. The layout table is in
[../reference/configuration.md](../reference/configuration.md).

## Common first-run issues

| Symptom | Cause and fix |
|---|---|
| `dev:server` exits with `PortInUseError` or "port already in use" | The server throws rather than picking a fallback port. Free the port or change `BACKEND_PORT`. |
| 401 from the API | `API_TOKEN` is set. Send `Authorization: Bearer <token>` or `X-API-Token: <token>`. |
| Runs fail with a configuration error | No usable provider endpoint. Check the settings page, or that the `${env:…}` variable exists. |
| Web starts on a different port than expected | The dev launcher probes 8280 and can be pointed elsewhere with `-p`. `FRONTEND_PORT` only feeds the CORS allowlist. |
