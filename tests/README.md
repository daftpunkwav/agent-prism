# Test layout

- `packages/<family>/<leaf>/tests/`: the leaf's unit and feature tests, next to `src/`. A
  test may reference only the package's own `../src/` and each package's public barrel.
  Cross-package deep-path imports are forbidden.
- `tests/`: cross-domain tests next to `packages/`, organized by journey or boundary,
  importing only through `@agentprism/*` public exports:
  - `tests/agent-execution/`: agent run journeys spanning `agent` and `runtime`:
    execution accounting and workspace lifecycle.
  - `tests/arena-runner/`: arena multi-column run journeys, covering column-session
    isolation, breaker interplay, and metrics linkage.
  - `tests/http-transport/`: HTTP transport contracts, covering routes and error mapping.
  - `tests/drivers/`: cross-backend driver consistency, covering the banner map and
    reasoning support.
- `apps/<app>/tests/`: app-level tests, next to `src/`:
  - `apps/web/tests/`: frontend app tests for the i18n contracts.
  - `apps/server/tests/`: testable runtime units such as port probing.

Put a new test in the directory it belongs to. Single-package tests go in the package's
own `tests/`; only genuinely multi-package flows go under the root `tests/` journey
directories.

## What the app layer tests

`apps/server/tests/` covers the host as far as reading allows: the boot smoke
(`assemble.test.ts`: health, sessions, meta, builder endpoints, arena logs), the entry
sequencing (`main.test.ts`: assemble → startServer → signal handlers, plus the shutdown
order), signal-driven graceful shutdown (`lifecycle.test.ts`), and the port preflight.
`apps/web/tests/` holds the jsdom + testing-library suites for pages, sections, and hooks.
Neither layer starts a real browser, and no test drives the UI end to end; the CI `smoke`
job boots the built host over HTTP for that. Business logic still belongs to journey tests.

## Single responsibility

- One test file tests one thing. Split by function, route domain, or journey.
- Shared scaffolding over about 25 lines moves into a support module in the same directory
  (`*fixtures.ts`, `mock-deps.ts`) without a `.test` suffix, so the runner never picks it
  up.
- Small shared pieces of about 10 lines or fewer may repeat inline to keep each file
  self-contained.

```bash
pnpm test              # run the full suite
pnpm typecheck:tests   # typecheck tests only
```
