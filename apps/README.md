# apps/

The workspace glob `apps/*` holds the two runnable applications. They sit at the top of
the dependency graph: they consume `@agentprism/*` packages and are not consumed by them.
They are applications rather than capability leaves, so the leaf README contract in
[packages/README.md](../packages/README.md) does not apply to them.

| App | Package | Role | Entry |
|---|---|---|---|
| [`server/`](server/) | `@agentprism/server` | Composition root and HTTP host: settings, driver registration, route mounting, service assembly, and port listening | `src/main.ts` |
| [`web/`](web/) | `@agentprism/web` | Next.js frontend with the arena, builder, sessions, threads, and settings pages | `src/app` |

## server/

- `src/main.ts` runs `assemble()`, then `startServer()`, then `installSignalHandlers()`.
- `src/assemble.ts` is the only composition root. It is the only place allowed to
  construct the driver registry, call `registerDriversBestEffort`, and mount the
  `register*Routes` leaves.
- `src/load-drivers.ts` defines `builtinDriverLoaders`, the dynamic imports of the driver
  backends.
- `src/mount-routes.ts` mounts the route leaves in order. `GET /api/sessions/stats` is
  registered before `GET /api/sessions/:sessionId`.
- `src/server.ts`, `src/portcheck.ts`, and `src/lifecycle.ts` cover serving, port
  validation, and signal handling.

The startup order and guards are detailed in
[docs/architecture/composition-root.md](../docs/architecture/composition-root.md).

## web/

- `src/app` holds the Next.js App Router pages.
- `src/components` holds presentation components.
- `src/i18n` holds the catalogs and the in-app guide content. UI copy lives in
  `src/i18n/catalogs/{en,zh-CN}` and is checked by
  `pnpm --filter @agentprism/web check:i18n`.

## Dependency constraints

- `apps/server` may depend on any `@agentprism/*` package, because it is the composition
  root.
- `apps/web` may depend only on `client`, `ui`, and `arena-view`, enforced by
  `scripts/check-boundaries.mjs`.

Build and run commands are in the root [README.md](../README.md) and
[docs/operations/runbook.md](../docs/operations/runbook.md).
