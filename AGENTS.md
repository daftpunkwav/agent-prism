## Git conventions

`main` must stay releasable at all times. Never commit or push to `main` directly.

### Branch naming

```
<type>/<kebab-case-description>
```

`type`: `feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf`

Examples: `feat/context-compaction`, `fix/memory-dedup`, `refactor/split-parser`

### Commit messages

Format:

```
<type>(<scope>): <subject>

<body>
```

- `<scope>` is optional; omit the parentheses when there is none.
- `<subject>`: imperative, lowercase, no trailing period, 72 characters max.
- `<body>` is required. State what changed and why. Wrap at 72 characters.

Example:

```
fix(parser): handle unbalanced brackets

Nested generics in the test corpus exposed a missing depth check. The
parser stopped at the first unmatched `<`, silently truncating a valid
type signature instead of raising an error.
```

Rules:

- One commit does one thing. Split unrelated changes.
- No WIP, debug output, commented-out code, or placeholder values.
- No secrets, `.env` files, credentials, or large binaries.
- Revert with `git revert`, keeping the original subject prefixed with `Revert: `.

### Workflow

1. Open an issue first when the change is a bug, is behavior-changing, or needs design
   discussion. Include what breaks, how to reproduce, and expected vs. actual. Trivial
   one-line fixes, typos, and documentation corrections may skip the issue.
2. Branch from up-to-date `main` using the naming above.
3. Make the change and add or update tests. A bug fix requires a regression test that fails
   before the fix and passes after it.
4. Run the project checks. Do not open a PR with failing checks.
5. Open a PR to `main`. Title = the final squashed commit message. Body states what changed,
   why, how it was verified, and any compatibility impact.
6. Merge with squash. Delete the branch locally and remotely.

### Branch hygiene

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

- Rebase on `origin/main` regularly. Never use plain `--force` on a shared branch.
- Open a draft PR early when a change spans more than a few commits.
- Ship a production-breaking fix from a `fix/*` branch off the broken `main` commit, then
  backport if a release branch exists.

### After merge

```bash
git switch main
git pull --ff-only
git branch -d <branch>
git push origin --delete <branch>
```

End every task with a clean working tree and nothing unpushed.
