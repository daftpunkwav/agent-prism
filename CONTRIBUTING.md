# Contributing

> Language: **English** | [简体中文](CONTRIBUTING.zh.md)

This guide is the onboarding layer for contributors. Every rule here points at a
single-source document; when prose and code disagree, the code and
`scripts/check-boundaries.mjs` win.

## Environment

- Node.js >= 20.9 (`engines` in the root `package.json`) and pnpm 11 (the
  `packageManager` field pins the exact version).
- **Windows is the reference platform.** CI runs on `windows-latest` because the
  restricted-token sandbox and the process-runner suites are Win32-only; on another
  OS those security-relevant cases skip. Development on other platforms works for
  most packages, but the platform-gated tests will not run there.
- `pnpm install` at the repo root, then configure the repo-root `.env` (never
  committed). Environment keys are documented in
  [docs/reference/configuration.md](docs/reference/configuration.md); a first-run
  walkthrough is [docs/guides/getting-started.md](docs/guides/getting-started.md).

## Workflow

1. Branch from `main` as `<type>/<kebab-case-description>`, e.g.
   `feat/context-compaction`.
2. Commit with Conventional Commits: `<type>: <subject>` where type is `feat`,
   `fix`, `docs`, `refactor`, `chore`, `test`, or `perf`; the subject is imperative,
   at most 50 characters, and one commit carries one concern.
3. Keep every diff traceable to its change; do not refactor unrelated code in
   passing. The full conventions live in [AGENTS.md](AGENTS.md).

## Before you push: quality gates

```bash
pnpm verify                                # build + typecheck + coverage + boundaries + check:deps + check:exports
pnpm --filter @agentprism/web lint         # web ESLint, after UI code changes
pnpm --filter @agentprism/web check:i18n   # web i18n gate, after frontend copy changes
```

What each gate owns and what a failure means:
[docs/operations/quality-gates.md](docs/operations/quality-gates.md). CI runs the
same gates on `windows-latest`, plus a `smoke` job that boots the real server binary
and probes it over HTTP.

## Tests

- Run from the repo root: `pnpm test`, or `pnpm test:coverage` for the
  threshold-gated run. Test strategy and budgets:
  [docs/operations/testing.md](docs/operations/testing.md).
- Placement: a single-package test belongs in that package's own `tests/`; only
  genuinely multi-package flows go under the root `tests/` journeys. The placement
  rules are in [tests/README.md](tests/README.md).
- Coverage thresholds are a gate: a red coverage gate means restore the tests, not
  lower the numbers.

## Docs and copy

- A behavior change updates the documentation pair. `docs/` mirrors the code in
  English and Simplified Chinese (see [docs/README.md](docs/README.md) for the map).
- Code and comments are English-only. User-visible UI copy lives in the i18n
  catalogs — `en` canonical, `zh-CN` mirrored, never inline — enforced by the
  `check:i18n` gate.

## Submitting

- One concern per pull request, gates green, and the behavior delta described in the
  body. CI (verify + smoke) must pass.
- Extension how-tos live in `docs/guides/`: [add-a-tool](docs/guides/add-a-tool.md),
  [add-a-driver](docs/guides/add-a-driver.md),
  [add-a-dimension](docs/guides/add-a-dimension.md), and
  [add-a-package](docs/guides/add-a-package.md).

## Security

Do not open public issues for vulnerabilities. Report privately per
[SECURITY.md](SECURITY.md).

## License

The project is licensed under the [MIT license](LICENSE); by contributing you agree
that your contributions are licensed under it as well.
