# packages/ agent rules

Working rules for coding agents touching any `@agentprism/*` leaf. The family
table and per-family roles live in [README.md](README.md); the architecture
map and dependency rules live in
[docs/architecture.md](../docs/architecture.md). This file is only the
working conventions.

## Layout

- Packages sit two levels deep: `packages/<family>/<leaf>/`. Every leaf is a
  real workspace package (`@agentprism/<leaf>`, glob `packages/*/*`) shipping
  `src/ tests/ README.md package.json tsconfig.json`. A new leaf is not done
  until all five exist, the family README table lists it, and
  `pnpm install` picks it up.
- Every source file opens with the `@file` header block: `@file`, one
  `@description` line, a `Responsibilities:` block, then a closing constraint
  note. Match the surrounding files; the header documents the contract, not
  the implementation.

## Boundaries and exports

- Dependency directions are fixed. `pnpm boundaries` (import graph) and
  `pnpm check:deps` (package.json edges) are the gate — when they fail, the
  change is wrong; do not weaken a check to pass it.
- `pnpm check:exports` requires every callable public export to be referenced
  by a test harness file. An export without coverage fails CI: delete it or
  test it.
- Leaf tests may import only their own `../src/` and other packages' public
  barrels. Deep cross-package imports are forbidden (placement details in
  [tests/README.md](../tests/README.md)).

## Dependencies and build

- Internal dependencies use `workspace:*`. A cross-package devDependency
  creates a pnpm build-task edge and can cycle the build graph; cross-package
  consistency tests belong in the root `tests/` journeys instead.
- Dependents build and typecheck against `dist/` (vitest aliases point tests
  at `src/`, but package typecheck does not). After changing a package's
  public API, `pnpm -r build` before trusting any downstream typecheck.
