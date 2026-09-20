# Packages

Splitting is evidence-based. A package is split when two implementations or two genuinely
different responsibilities exist, and cohesive leaves stay together. Extending an
existing leaf is preferred over creating a parallel one.

## Leaf anatomy

A new leaf lives at `packages/<family>/<leaf>/`. A new family directory also needs a
family `README.md` role table. Single-leaf families mirror the name, as in `foo/foo`.

## package.json

`"name": "@agentprism/<leaf>"`, `"private": true`, `"type": "module"`, `exports` to
`./dist/index.js`, `files: ["dist"]`, `build` and `typecheck` scripts, and dependencies
that match actual imports only. `pnpm check:deps` fails on stale, missing, or test-only
runtime declarations and suggests demoting test-only dependencies to `devDependencies`.

## tsconfig.json

Extends `../../tsconfig.base.json` at the same depth as sibling leaves.

## Source

`src/index.ts` is the public barrel and stays minimal. `import type` edges do not count
toward dependency cycles but do count for declaration honesty.

## README.md

States responsibilities, seam surface, and dependency direction, as part of the leaf
contract.

## Registration

- `pnpm-workspace.yaml` needs no change because `packages/*/*` covers the leaf. Run
  `pnpm install` to link.
- Vitest aliases are generated from leaf `package.json` files.
- `tsconfig.tests.json` needs one manual `paths` entry:
  `"@agentprism/<leaf>": ["./packages/<family>/<leaf>/src/index.ts"]`, because wildcard
  substitution is illegal under TS5096.

## Boundary rules

A leaf that participates in a restricted direction, such as plugins, routes, the session
family, context leaves, or apps, adds its rule to the `RULES` array in
`scripts/check-boundaries.mjs`. Unrestricted leaves are still audited by `check:deps`.

## Documentation

The leaf is added to the family `README.md` table, to `packages/README.md`, and to the
family map in [../architecture.md](../architecture.md). A user-facing concept is also
added to [../architecture/overview.md](../architecture/overview.md).

## When not to create a package

- A single function or ToolDefinition belongs in an existing leaf.
- Cohesive subdirectories stay unsplit, such as `harness` and `contracts`.
- A second deliverable shape that does not exist yet needs no package, which is why the
  composition root stays in `apps/server`.
