<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/web agent rules

Working rules for coding agents in this app. The command table, ports, proxy
and CSP notes, and source layout live in [README.md](README.md).

## Dependencies

- This app may depend only on `@agentprism/client`, `@agentprism/ui`, and
  `@agentprism/arena-view` (enforced by `scripts/check-boundaries.mjs`). It
  must not import `@agentprism/contracts` directly.

## i18n gate

- `pnpm --filter @agentprism/web check:i18n` runs in CI: the `en` and
  `zh-CN` catalogs must stay key-symmetric, and user-visible copy must live
  in the catalogs — no inline CJK strings in `src/app/` or `src/components/`
  (comments and `console.*` calls are stripped before scanning). A line that
  legitimately contains non-copy CJK takes an `// i18n-exempt` marker.
- Translation keys are typed (`MessageKey` from `@/i18n/catalogs/types`).
  Dynamic keys go through the `catalogOrFallback` pattern — typed cast plus a
  runtime fallback — so a missing catalog entry degrades visibly instead of
  rendering a raw key.

## Lint

- `pnpm --filter @agentprism/web lint` runs in CI (errors block; the existing
  warnings are advisory). Rule carve-outs in `eslint.config.mjs` carry their
  reasons inline — read them before adding another.

## Tests

- The 58 suites in `tests/` run under the root vitest config from the repo
  root; it maps the `@/` alias to `src/`. Component tests render through
  jsdom + testing-library.
