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

## What the app layer does not test

Listeners and serve (`main` and `server`), signal handling, and Next.js pages and
components, which need a browser runtime. The assembly root allows only a read-only boot
smoke test, `apps/server/tests/assemble.test.ts`, which covers health, sessions, and meta,
starts no runs, and writes nothing. Business logic belongs to journey tests.

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
