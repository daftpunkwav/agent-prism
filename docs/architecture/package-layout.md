# Package layout and conventions

The repository is a pnpm workspace with exactly two glob roots in
`pnpm-workspace.yaml`: `apps/*` and `packages/*/*`. Every capability lives at the
two-level path `packages/<family>/<leaf>/`. There are no flat packages.

## Family and leaf anatomy

- A family directory groups related leaves and carries a role-table `README.md`. The
  index is [packages/README.md](../../packages/README.md).
- A leaf is a real workspace package named `@agentprism/<leaf>` that ships exactly:
  `src/` with the public barrel `src/index.ts`, co-located `tests/`, a `README.md`
  stating responsibilities, seam surface, and dependency direction, `package.json` with
  `private: true`, and a `tsconfig.json` that extends the root base.
- Single-leaf families mirror the family name, for example `agent/agent` and
  `contracts/contracts`, following the uniform-layout convention described in
  [architecture.md](../architecture.md).

Current families cover 65 leaves: `agent`, `application`, `arena-view`, `arena`,
`builder`, `client`, `config`, `context` with 8 `context-*` leaves, `contracts`,
`dimensions`, `drivers` with 11, `environment`, `evaluation`, `harness`, `memory` with 4,
`persistence`, `providers` with 2, `runtime`, `sandbox`, `session` with 8, `telemetry`,
`tools` with 4, `transport` with 9, and `ui`.

## Dependency iron rules

Enforced by `pnpm boundaries` from `scripts/check-boundaries.mjs`. Declaration honesty
is enforced separately by `pnpm check:deps`. See
[../operations/quality-gates.md](../operations/quality-gates.md).

1. `contracts` imports zero `@agentprism/*`. `environment` and `persistence` are also
   dependency-free leaves.
2. The eight `context-*` leaves are dependency-free.
3. Plugin leaves consume seams, never composers or providers:
   - `tool-registry` depends only on `contracts`. `tool-builtins` only on `contracts`,
     `environment`, `tool-registry`, and `tool-symbols`. `tool-mcp` only on `contracts`
     and `tool-registry`.
   - `driver-run-support` depends only on `contracts`, `environment`, `runtime`,
     `telemetry`, `harness`, and `zod` (the shared tool-schema derivation). Backends
     additionally take `driver-run-support`; the LangChain family also takes
     `driver-langchain` (`driver-langgraph`, `driver-deepagents`).
   - `provider-catalog` depends only on `contracts`, `config`, `persistence`,
     `environment`, `runtime`, and `telemetry`. `provider-langchain` additionally takes
     `provider-catalog`.
4. `arena` never touches `@langchain/*` or providers. `application` never touches
   provider or evaluation implementations.
5. `http-runtime` and `route-*` depend only on `application`, `builder`, `config`, and
   `contracts`, with routes also dependent on `http-runtime`. The shell never depends
   back on routes.
6. `apps/web` may depend only on `client`, `ui`, and `arena-view`.

The full per-package rule list is the `RULES` array in `scripts/check-boundaries.mjs`,
which is the single source of truth.

## Name resolution

| Mechanism | File | How it stays correct |
|---|---|---|
| Runtime, vitest | root `vitest.config.ts` | generated: `workspaceAliases()` scans every leaf `package.json` and maps `name` to `src/` at config-load time, so new leaves need no edit |
| Typecheck, tests | root `tsconfig.tests.json` | hand-maintained: one explicit `paths` entry per package, because TS5096 allows at most one `*`, so new leaves must add one line |
| Editor | root `tsconfig.json` | extends `tsconfig.tests.json` so editors resolve workspace imports from files under `tests/`; no repository script passes it with `-p` |

## Where things go

| You are adding… | Put it in… | Guide |
|---|---|---|
| A tool | `packages/tools/tool-builtins/src/definitions/<name>.ts` | [../guides/add-a-tool.md](../guides/add-a-tool.md) |
| A framework driver | `packages/drivers/driver-<name>/` | [../guides/add-a-driver.md](../guides/add-a-driver.md) |
| A comparison dimension | `packages/dimensions/dimensions/src/dimensions/<name>.ts` | [../guides/add-a-dimension.md](../guides/add-a-dimension.md) |
| A package | `packages/<family>/<leaf>/` | [../guides/add-a-package.md](../guides/add-a-package.md) |
| A cross-domain test | `tests/<journey>/`, public exports only | [../operations/testing.md](../operations/testing.md) |
| An HTTP route | `packages/transport/route-<domain>/` | [../reference/http-api.md](../reference/http-api.md) |

## Conventions across packages

- Tests are either leaf-local in `packages/<family>/<leaf>/tests/` or cross-domain
  journeys in `tests/<journey>/`. A package test never reaches into another package's
  internals, and journeys go through public barrels only.
- Every leaf README states responsibilities, seam surface, and dependency direction.
- Code, comments, and documentation are English. User-visible UI copy lives in the i18n
  catalogs under `apps/web/src/i18n/catalogs/`.
- The decision register is [decision-register.md](decision-register.md).
