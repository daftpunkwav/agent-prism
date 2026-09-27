# tests/ agent rules

This directory holds cross-domain journey tests. Placement rules and the
per-area breakdown live in [README.md](README.md).

## What belongs here

- Only genuinely multi-package flows. A test a single leaf could own goes in
  that leaf's own `tests/` (`packages/*/*/tests/` or `apps/*/tests/`).
- Imports cross only `@agentprism/*` public exports — never deep paths into
  another package's `src/`.

## Running

- The suite runs under the root vitest config. Run from the repo root
  (`pnpm test`, or `pnpm exec vitest run tests/<area>` for one area): the
  config resolves the `@agentprism/*` aliases, and running vitest from
  another directory silently misses them.
- The generous budgets are deliberate (`testTimeout: 30_000` in the root config,
  and `{ retry: 1 }` on the suites that spawn real processes): journey tests spawn
  real PowerShell children whose cold start exceeds the vitest default, and Windows
  file-lock release is eventual. Retry is opt-in per suite — the root config keeps
  `retry: 0`, so a flaky suite must declare its own tolerance instead of every test
  getting a second chance. Do not lower the root budgets to speed up a run; set an explicit
  budget on the one slow test if it needs one.
- `pnpm test:coverage` enforces the coverage thresholds in the root config.
  A red gate means restore the tests, not lower the numbers.
