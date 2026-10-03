<!--
The PR title becomes the subject of the squashed merge commit:
  <type>(<scope>): <subject> — imperative, lowercase, ≤ 72 chars, no trailing period.

One PR does one thing. Split unrelated changes into separate PRs;
merge requirements live in the branch ruleset (2 approvals, threads
resolved, up to date with main).
-->

## What

<!-- A few sentences: what changes? Lead with the behavior, not the file list. -->

## Why

<!-- The problem or motivation. Link the issue (`Closes #123`), or state why
     there is no issue: bug fixes and behavior changes need one; typos and
     doc corrections may skip it. -->

## How

<!-- What a reviewer should know: key decisions, alternatives considered and
     rejected, boundaries touched (public exports, config, CI, contracts).
     Delete this section if the diff is self-explanatory. -->

## Verification

<!-- How you proved it works and did not break anything else. CI runs the
     same gates; local runs catch failures before the push. -->
- [ ] Tests added or updated — a bug fix ships a regression test that fails
      before the fix and passes after it
- [ ] `pnpm -r build`
- [ ] `pnpm -r typecheck` and `pnpm typecheck:tests`
- [ ] `pnpm --filter @agentprism/web lint`
- [ ] `pnpm --filter @agentprism/web check:i18n`
- [ ] `pnpm test:coverage`
- [ ] `pnpm boundaries` (import boundaries)
- [ ] `pnpm check:deps` (dependency hygiene)
- [ ] `pnpm check:exports` (public export coverage)
- [ ] Anything the tests cannot reach was verified manually (describe below)

<!-- Manual steps, before/after output, screenshots. Delete if empty. -->

## Compatibility impact

<!-- Public API, exported types, config, or stored-data format changes?
     "None" is a valid answer — state it explicitly. If breaking: what breaks,
     who is affected, and the migration path. -->

## Security and supply chain

<!-- Does the change touch authentication or trust boundaries, dependency
     manifests/lockfiles, or GitHub workflows? security.yml audits the
     lockfile on every PR regardless of paths — use this section to give the
     reviewer context it cannot infer from the diff. Otherwise write "N/A". -->

## Reviewer notes

<!-- Non-obvious trade-offs, known follow-ups, areas that deserve extra
     scrutiny. Delete if empty. -->
