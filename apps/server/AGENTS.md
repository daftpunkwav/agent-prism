# apps/server agent rules

Working rules for coding agents in this app. The role table, source layout,
and command reference live in [README.md](README.md); the composition-root
deep dive is
[docs/architecture/composition-root.md](../../docs/architecture/composition-root.md).

## Composition-root discipline

- `src/assemble.ts` is the only composition root. Driver registration
  (`registerFrameworkDrivers`, which wraps `registerDriversBestEffort` in
  `load-drivers.ts`), domain route mounting (`mountDomainRoutes` in
  `mount-routes.ts`), and every wiring decision happen there and nowhere
  else — wire new capabilities through `assemble.ts`, not module state.
- Route registration order is behavior. `src/mount-routes.ts` mounts each
  domain leaf in a fixed order, and inside a route package literal paths
  register before parameterized ones (`GET /api/sessions/stats` before
  `GET /api/sessions/:sessionId` in `route-sessions`). Preserve registration
  order when adding routes.

## Build and run

- The server executes from `dist/`. The `predev` / `prestart` hooks compile
  first, so `pnpm dev:server` / `pnpm start:server` are always fresh; when
  booting `dist/main.js` by hand, run `pnpm -r build` first — dependency
  packages ship JS and types from `dist/`, and a stale workspace build fails
  somewhere downstream of the actual edit.
- Default listen address is `127.0.0.1:8281` (`BACKEND_HOST`/`BACKEND_PORT`
  via the repo-root `.env`); `src/portcheck.ts` validates availability before
  listening. CI smoke boots on 8291 through env overrides.

## Configuration flow

- Environment keys load through `@agentprism/config` from the repo-root
  `.env` (single configuration source). `assemble.ts` writes a few
  driver-knob env vars (`ARENA_SELF_CONSISTENCY_N`, `ARENA_TOT_WIDTH`,
  `ARENA_CREWAI_PROCESS`) from the runtime knobs and reads `MCP_SERVERS` to
  seed the MCP store — that file is the bridge; add new knobs through
  settings/config, not scattered `process.env` reads.

## Tests

- `tests/` holds host-level runtime units only: a real `assemble()` boot on a
  real port, route mounting, driver loading, lifecycle, and the boot-failure
  path. Business-logic tests belong in the owning package, not here.
- The suite runs under the root vitest config (it globs `apps/*/tests`); run
  tests from the repo root so the root config applies.
