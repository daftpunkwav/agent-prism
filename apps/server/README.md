# server/

`@agentprism/server` is the composition root and HTTP host: a thin Hono server that
wires every `@agentprism/*` capability together and serves the API over one port.
It owns no business logic — everything below it is a workspace package.

For the role table and dependency constraints see
[apps/README.md](../README.md); startup-order details live in
[docs/architecture/composition-root.md](../../docs/architecture/composition-root.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev:server` | `tsc` build, then `node --watch dist/main.js` (edit-restart loop) |
| `pnpm start:server` | `tsc` build, then `node dist/main.js` |
| `pnpm --filter @agentprism/server build` | Compile `src/` to `dist/` |
| `pnpm --filter @agentprism/server typecheck` | Typecheck without emitting |

The `predev` / `prestart` hooks run the `tsc` build automatically, so `dist/` is
always fresh before the server boots. The package also ships a `bin`
(`agent-prism-server` → `dist/main.js`) for installed use.

## Configuration

Environment keys are read by `@agentprism/config` from the repo-root `.env`
(single configuration source; see `packages/config`):

| Key | Default | Meaning |
|---|---|---|
| `BACKEND_HOST` | `127.0.0.1` | Listen address |
| `BACKEND_PORT` | `8281` | Listen port; `src/portcheck.ts` validates availability first |
| `API_TOKEN` | empty | When set, API requests must carry it |

## Source layout

| File | Role |
|---|---|
| `src/main.ts` | Boot order: `assemble()` → `startServer()` → `installSignalHandlers()` |
| `src/assemble.ts` | The only composition root: constructs the driver registry, applies `registerDriversBestEffort`, and mounts the route leaves |
| `src/load-drivers.ts` | `builtinDriverLoaders`, the dynamic imports of the driver backends |
| `src/mount-routes.ts` | Mounts route leaves in order; `GET /api/sessions/stats` registers before `GET /api/sessions/:sessionId` |
| `src/server.ts` | Hono app serving |
| `src/portcheck.ts` | Port availability validation |
| `src/lifecycle.ts` | Signal handling and graceful shutdown |

## Tests

`tests/` holds the host-level suite: a real `assemble()` boot probed over a real
port (`assemble.test.ts`), route mounting, driver loading, signal lifecycle, and
the boot-failure path. Placement rules follow
[tests/README.md](../../tests/README.md); the suite runs under the root
`pnpm test` (the root vitest config globs `apps/*/tests`).
