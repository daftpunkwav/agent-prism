# Quality gates

All gates are plain npm scripts. No pre-commit hooks are wired in the repository. Run
them manually or in CI. The standard full sweep is:

```bash
pnpm verify    # build + typecheck + coverage + boundaries + check:deps + check:exports
pnpm --filter @agentprism/web lint         # web ESLint, after UI code changes
pnpm --filter @agentprism/web check:i18n   # web i18n gate, after frontend copy changes
```

## The gates

| Gate | Script | Owns | Failure means |
|---|---|---|---|
| Direction | `pnpm boundaries` from `scripts/check-boundaries.mjs` | Import direction between packages, checked by a regex line scan of ts and tsx files under each rule's roots | an import violates a direction rule, such as `contracts` importing any `@agentprism/*`, a plugin importing a composer, or `apps/web` importing anything but client, ui, and arena-view |
| Honesty | `pnpm check:deps` from `scripts/check-package-deps.mjs` | Declaration against reality: undeclared value imports, type-only imports, unused declared deps, and value-edge cycles with type-only edges ignored | stale or missing declarations, or a runtime dependency used only in tests, which warns with a demote-to-devDependencies suggestion |
| Tests | `pnpm test`, root vitest | behavior | any suite failure |
| Types | `pnpm typecheck` | whole-repo type safety | a type error; build packages first so cross-package resolution is fresh |
| Lint | `pnpm --filter @agentprism/web lint`, ESLint 9 flat config in `apps/web/eslint.config.mjs` | web app lint discipline (Next.js core-web-vitals and typescript rules) | an ESLint error; warnings are advisory, and any rule carve-out carries its reason inline |
| Export-test coverage | `pnpm check:exports`, from `scripts/check-export-tests.mjs` | every callable public export is referenced by a test harness file | a callable public export with no referencing test — delete it or test it |
| i18n | `pnpm --filter @agentprism/web check:i18n` from `apps/web/scripts/check-i18n.mjs` | UI copy discipline | en and zh-CN catalog key parity fails, or inline CJK is found in `src/app` or `src/components`; comments and `console.*` are stripped, and lines marked `i18n-exempt` are skipped |

The direction rules are listed in the `RULES` array in `scripts/check-boundaries.mjs`,
which is the single source of truth. The headline invariants are: `contracts` is a
zero-dependency leaf; plugins such as drivers, tools, and providers never reach upward to
composers or providers; the transport shell never depends back on routes; and `apps/web`
depends only on `client`, `ui`, and `arena-view`.

## Conventions the gates assume

- Conventional Commits with the form `<type>: <subject>`, where type is `feat`, `fix`,
  `docs`, `refactor`, `chore`, `test`, or `perf`. The subject is imperative and at most
  50 characters, with one concern per commit. Branches are `<type>/<kebab-case>`. The
  rules are defined in the workspace `AGENTS.md`.
- Language policy: code and comments are English. Documentation ships in English and
  Simplified Chinese. User-visible UI copy lives in the i18n catalogs, with `en` as the
  canonical locale and `zh-CN` mirrored, and never inline.
- Leaf README contract: every package README states responsibilities, seam surface, and
  dependency direction, enforced at review.
- Docs hierarchy: `docs/` mirrors the code and must not contradict it. When it does, the
  code and `scripts/check-boundaries.mjs` win.

## Gate-adjacent changes

- A new package likely needs a `boundaries` rule. See
  [../guides/add-a-package.md](../guides/add-a-package.md).
- A new endpoint extends the matching `tests/http-transport/` file. One endpoint per leaf
  is pinned by `mount-routes.test.ts`.
- New UI copy needs catalogs in both locales and a green `check:i18n`.
