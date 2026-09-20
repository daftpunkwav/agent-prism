# web/

`@agentprism/web` is the Next.js App Router frontend: the arena, builder,
sessions, projects, settings, and the in-app guide/learn pages. It talks to the
backend only through the same-origin `/api` proxy and consumes exactly three
workspace packages.

For the role table and dependency constraints see
[apps/README.md](../README.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `scripts/dev.mjs`: port preflight, then the Next dev server on 8280 |
| `pnpm --filter @agentprism/web build` | `next build` |
| `pnpm start` (in this app) | `next start -p 8280` |
| `pnpm --filter @agentprism/web lint` | ESLint |
| `pnpm --filter @agentprism/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @agentprism/web check:i18n` | Locale-catalog consistency gate |

`scripts/dev.mjs` does three things a bare `next dev` would not: it probes the
port first (bind + connect double check) and exits with guidance on conflict; it
accepts `-p/--port` to move the port; and it forces `NODE_ENV=development` so a
shell-global production value cannot trigger the production CSP, which breaks
client hydration.

## Ports and proxying

- The dev/prod server listens on **8280**; the backend on **8281**.
- `next.config.ts` rewrites same-origin `/api/:path*` to
  `http://127.0.0.1:$BACKEND_PORT`, so the browser never talks cross-origin.
- `BACKEND_PORT` resolves in order: process env → repo-root `.env` → `8281`
  fallback. Editing `.env` is the single configuration source; the proxy
  follows automatically.
- `compress: false` is deliberate: Next's gzip buffers the proxied SSE stream
  and flushes only at completion, which would render arena traces all at once
  instead of step by step.
- CSP is looser in dev (`unsafe-inline`/`unsafe-eval` for hot reload) and
  tightened for production builds. Switching to a direct cross-origin backend
  (`NEXT_PUBLIC_API_BASE`) requires adding that address to `connect-src`, or
  REST and SSE requests are silently blocked.

## Source layout

| Path | Role |
|---|---|
| `src/app/` | App Router pages: `arena`, `builder`, `sessions`, `projects`, `settings`, plus `guide` and `learn` |
| `src/components/` | Presentation components shared across pages |
| `src/i18n/` | Locale catalogs (`catalogs/en`, `catalogs/zh-CN`) and the guide/learn content; see [src/i18n/README.md](src/i18n/README.md) |
| `scripts/` | `dev.mjs` launcher and `check-i18n.mjs` gate |

## Dependencies

`apps/web` may depend only on `@agentprism/client`, `@agentprism/ui`, and
`@agentprism/arena-view`, enforced by `scripts/check-boundaries.mjs`. It must
not import `@agentprism/contracts` directly.

## Tests

`tests/` holds 58 jsdom + testing-library suites covering pages, sections, and
hooks. They run under the root `pnpm test` (the root vitest config globs
`apps/*/tests` and maps the `@/` alias to `src/`).
