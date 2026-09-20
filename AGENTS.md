## Git conventions

### Commit messages (Conventional Commits)

```
<type>: <subject>
```

`type` is a standard type such as `feat`/`fix`/`docs`/`refactor`/`chore`/`test`/`perf`;
the subject is imperative, ≤ 50 characters, describes the behavior directly, and carries
no internal phase numbers (e.g. P0–P9); one commit does one thing.

Examples: `feat: initialize project repository`, `fix: long-session context overflow`

### Branch naming

```
<type>/<kebab-case-description>
```

`type` as above; the description is kebab-case.

Examples: `feat/context-compaction`, `fix/memory-dedup`
