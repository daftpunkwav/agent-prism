## Git conventions

`main` is the default branch. All changes reach it through a pull request.

>> **Note**: Custom local instructions or personal environment configurations are defined in [AGENTS.local.md](AGENTS.local.md). If there is a conflict between this document and `AGENTS.local.md`, **AGENTS.md takes precedence**.

### Branch naming

```text
<type>/<kebab-case-description>
```

`type` options:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation-only changes
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `chore`: Routine tasks, maintenance, dependency bumps, etc.
- `test`: Adding missing tests or correcting existing tests
- `perf`: A code change that improves performance
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `style`: Formatting, missing semicolons, white-space fixes (no production code changes)

Examples: `feat/section-renderer`, `fix/page-overflow`, `docs/layout-notes`, `ci/github-actions`

### Commit messages

Format:

```text
<type>(<scope>): <short summary>

<body>
```

- `<scope>` is optional; omit the parentheses when there is none.
- `<short summary>`: imperative verb, concise, no trailing period. The entire first line (`<type>(<scope>): <short summary>`) must be **72 characters max** (the `Revert:` message is the only exception; see below).
- `<body>` (optional for self-explanatory changes): state what changed and why.

Example:

```text
fix(render): clip a block that exceeds the page height

A section with more content than the remaining space produced a block that
overlapped the footer instead of overflowing. The height calculation ignored
the block's top offset.
```

Rules:

- One commit does one thing. Split unrelated changes.
- Focus strictly on the code diff (what changed and why). Do not include project-management progress notes or mention third-party scanning/CI tools.
- No WIP, debug output, commented-out code, or placeholder values.
- No secrets, `.env` files, or credentials.
- Revert with `git revert`. Its message is the one exception to the header format and 72-character subject limit above: the original subject prefixed with `Revert:`, plus a body stating why the change is being reverted.

### Workflow

1. **Issue creation (prioritized, not strictly mandatory)**:
   - **Bug fixes & large changes**: Prioritize opening an issue first to document what breaks, reproduction steps, and expected vs. actual behavior (minor or trivial bug fixes may skip the issue).
   - **Other changes (`feat`, `ci`, `docs`, `refactor`, `chore`, etc.)**: Opening an issue is not mandatory unless the change is large in scope or requires architectural discussion.
2. Branch from up-to-date `main` using the naming above.
3. Make the change. Add or update tests where the change is behaviour that a test can observe; a bug fix requires a regression test that fails before the fix and passes after it.
4. Verify all changes and tests locally, then open a PR to `main`:
   - Format the PR title concisely (e.g., `<type>(<scope>): <summary>`). The body states what changed, why, how it was verified, and any compatibility impact.
   - **Note on line limits**: While the Git commit subject line is strictly capped at 72 characters, **the PR title, PR body, issues, and review comments are not subject to the 72-character per line limit** and may be formatted naturally for clarity and readability.
5. Merge with squash once all required checks and reviews pass. Delete the branch locally and remotely.

### Branch hygiene

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

- Rebase on `origin/main` whenever it has moved ahead of your branch (at minimum before each push). Never use plain `--force` on a shared branch; the only exception is `--force-with-lease`, used immediately after a rebase.
- Complete local self-review and test verification before pushing to minimize unnecessary CI and reviewer runs.

### After merge

```bash
git switch main
git pull --ff-only
git branch -d <branch>
git push origin --delete <branch>
```

End every task with a clean working tree and nothing unpushed.
