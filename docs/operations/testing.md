# Testing

Conventions live in [tests/README.md](../../tests/README.md). This page is the
operational map: runners, resolution mechanics, and what runs where.

## Test tiers

1. Leaf tests in `packages/<family>/<leaf>/tests/` next to `src/`. A leaf test may
   reference only its own `../src/` and public barrels.
2. Journey tests in `tests/<journey>/`, cross-domain, importing only through
   `@agentprism/*` public exports:
   - `tests/agent-execution/`: run accounting and workspace lifecycle, spanning `agent`
     and `runtime`.
   - `tests/arena-runner/`: column-session isolation, breaker interplay, and metrics
     linkage.
   - `tests/http-transport/`: the request contract, covering routes, auth, error
     mapping, limits, settings, and SSE streams, with 13 test files and a shared
     `mock-deps.ts`.
3. App tests: `apps/web/tests/` for i18n catalog parity, locale resolution, and component
   tests, and `apps/server/tests/` for `assemble`, `load-drivers`, `mount-routes`,
   and `portcheck`.

## Running

```bash
pnpm test                  # one root vitest run for everything
pnpm test:coverage         # same run, writing coverage reports to cov-report/
pnpm smoke                 # probe a running server over HTTP (see Smoke)
pnpm typecheck             # packages (build first) + apps + tests
pnpm typecheck:tests       # tsc -p tsconfig.tests.json --noEmit
pnpm verify                # build + typecheck + coverage + boundaries + check:deps
```

There are no per-package test scripts. The root `vitest.config.ts` include patterns pick
up every leaf: `tests/**/*.test.ts`, `packages/*/*/tests/**/*.test.{ts,tsx}`, and
`apps/*/tests/**/*.test.{ts,tsx}`. The environment is `node`. jsdom-style component tests
use testing-library with the configured environment.

## Coverage

`vitest.config.ts` collects coverage with the v8 provider over `packages/*/*/src` and
`apps/*/src`, and excludes pure barrels (`index.ts`), type-only modules (`types.ts`), test
scaffolding, and the filenames Next.js reserves for routing (`page`, `layout`, `loading`,
`error`, `not-found`, `template`, `default`, `route`). The reserved names are framework
mount points rather than behavior this project owns; every other file under
`apps/web/src/app` stays in scope and is covered by the jsdom and testing-library suite.
Files no test reaches are still counted, so a new module cannot enter the tree without
its share of tests. Reports land in `cov-report/` as text plus a JSON summary.

Coverage thresholds fail the run when any metric falls roughly four points under
the baseline at introduction (statements 87, branches 75, functions 88, lines 89).
The margin absorbs run-to-run noise and the platform-gated code the Windows
reference platform cannot reach, while turning a broad regression red instead of
letting coverage slide. Raise the bar as coverage improves; a red gate means
restoring the tests, not lowering the numbers.

## Public surface

`pnpm check:exports` walks every package's `src/index.ts`, classifies the public exports
as callable or data, and fails when a callable export is referenced by no test harness
file. Data exports (constants, schemas, enums) are not gated: they carry no behavior of
their own. `scripts/check-export-tests.mjs` holds a `PENDING` list of callable exports
that still lack a test. The list is a worklist and may only shrink.

## Smoke

`scripts/smoke.mjs` probes an already-running server over HTTP. It waits for the process
to answer, then checks `/health`, `/api/sessions`, and `/api/arena/meta`. It reads only,
starts no run, and exits non-zero with a per-check summary.

```bash
pnpm smoke                                      # http://127.0.0.1:8281
SMOKE_BASE_URL=https://host.example pnpm smoke  # any deployed environment
SMOKE_PORT=8291 SMOKE_TIMEOUT_MS=60000 pnpm smoke
SMOKE_API_TOKEN=secret pnpm smoke               # when API_TOKEN is set
```

## CI

`.github/workflows/ci.yml` runs on `windows-latest`. The `verify` job covers typecheck,
web lint, the i18n gate, coverage, import boundaries, dependency hygiene, and
export-test coverage. The `smoke` job builds the host, starts
`apps/server/dist/main.js`, and runs the smoke probe against it.

Windows is the reference platform: the restricted-token sandbox and the process-runner
suites are Win32-only, so another runner would skip the security-relevant cases.

## Name resolution

- Vitest aliases are generated. `workspaceAliases()` in the root `vitest.config.ts` scans
  leaf `package.json` files at config-load time and maps each `name` to its `src/`, so new
  packages need no edit. This is also why cross-leaf test references declare no
  devDependencies.
- Typecheck aliases are hand-maintained. `tsconfig.tests.json` has an explicit `paths`
  entry per package pointing at `src/index.ts`, because TS5096 forbids multi-star
  wildcards. New packages must add one line.
- Editors use the root `tsconfig.json`, which extends `tsconfig.tests.json`, so a file
  under `tests/` resolves workspace imports without editor-specific configuration. No
  build or gate script passes it with `-p`.

## What pins behavior where

| Area | Pinned by |
|---|---|
| HTTP contract: auth, limits, errors, SSE | `tests/http-transport/` |
| Composition wiring | `apps/server/tests/`. `mount-routes` checks one endpoint per leaf; `load-drivers` checks the registry is non-empty and includes `native` |
| i18n integrity | `apps/web/tests/catalog-parity.test.ts` for en and zh-CN key parity, and `pnpm --filter @agentprism/web check:i18n` |
| Driver banner consistency | the driver-registry banner test across all backends, with `PIPELINE_BANNER_PREFIX` as the single source |
| Toolset membership | contracts enums and tool-registry tests |
| Event contract | zod schemas in `contracts` and transport and journey tests |

## Conventions

- Test files live beside the code they own. A test that needs two packages' internals is
  a journey test and goes through public barrels only.
- Time is deterministic through the injected `Clock`; IDs are deterministic through the
  injected `IdGenerator`. Suite tests use no real sleeps.
- Behavioral deltas are pinned explicitly. The compaction strategies have unit tests that
  pin the delta against `sliding`.
- The full gate set is `pnpm verify`: build, typecheck, coverage, import boundaries,
  dependency hygiene, and export-test coverage.
