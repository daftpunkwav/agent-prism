# Sandbox enforcement layers

The runtime contains what shell tools such as `run`, `run_job`, and on POSIX
`bash_session` can do through three independent layers between a model-issued command and
the operating system. Each layer may only add denials. The deepest layer enforces at the
OS level rather than by inspecting the command text.

| Layer | Package | Mechanism | Enabled by |
|---|---|---|---|
| 1. Static command analysis | `packages/sandbox`, `command-analysis.ts` | Quote-aware tokenizer, layered deny rules, read-only allowlist. Denies catastrophic shapes such as `rm -rf` roots, disk wiping, and interpreter-wrapped hidden commands | always on; catastrophic deny is the floor |
| 2. Approval gate | `packages/sandbox`, `approval.ts` | `approval_mode: unless_trusted` restricts shell tools to known-safe read-only commands | `config.approval_mode`, a baseline field |
| 3. OS write sandbox | `packages/environment`, `sandbox-launcher.ts` and `win-sandbox-helper.ts` | Windows restricted-token spawn, so child processes may write only inside the workspace root | `config.sandbox_mode: os`, a baseline field |

Review order on the `beforeExecute` chain in `agent/src/agent-execution.ts`
`buildToolAccess` is: caller hook, then approval gate, then static analysis. The OS layer
is not a review step. It wraps the actual spawn of whatever passed review in
`process-runner.ts`, so commands that static analysis cannot judge, such as interpreter
escapes like `python -c "..."`, are still contained.

## Layer 3 mechanics, Windows restricted token

`process-runner.ts` transforms the argv into an invocation of a PowerShell helper from
`win-sandbox-helper.ts`. The helper is materialized under the OS temp dir with a cached
C# assembly beside it. Through P/Invoke it does the following:

1. Derives a capability SID from the writable root, using the SHA-256 of the lower-cased
   path so repeated spawns reuse the same SID and the grant stays idempotent. It writes
   one inheritable allow-write ACE for that SID on the root and its existing descendants.
   Reparse points such as junctions and directory symlinks are neither granted nor
   recursed into, because enumeration and the child's own path resolution follow such a
   link, and granting inside the root through it would write ACEs onto the link target's
   real files outside the workspace. Writes through a link therefore stay fail-closed.
   Exactly one writable root is supported; multi-root requests are refused rather than
   narrowed.
2. Clones the current process token with `CreateRestrictedToken`, using
   `WRITE_RESTRICTED | LUA_TOKEN | DISABLE_MAX_PRIVILEGE` and restricting SIDs
   `[logon SID, Everyone, capability SID]`. Write access then requires a restricting SID
   in the target DACL. Reads are unaffected.
3. Rewrites the token default DACL to `GENERIC_ALL` for the restricting SIDs so objects
   the child creates itself stay writable by the child.
4. Spawns the command with `CreateProcessAsUserW`, inheriting stdio so the host timeout,
   abort, and output caps apply unchanged, and assigns it to a Job Object with
   kill-on-close, so killing the helper kills the whole sandboxed tree.
5. Redirects the child's `TEMP` and `TMP` into `<workspace>/.sandbox-tmp` so transient
   files stay inside the writable root.

Any setup failure prints a nonce-authenticated sentinel line to stderr and exits 3, which
`process-runner.ts` maps to a process error. The spawn is never silently downgraded to an
unsandboxed run. The nonce prevents accidental or lazy marker collisions but is
best-effort rather than forgery-proof: it travels on the helper's command line, which a
same-user child can read, for example through WMI, and then fake a setup-failure line.
That can only mislabel a live command's outcome as a setup error and never weakens the
containment itself. Removing the exposure would require a private setup-status channel.

## Configuration

Both modes are per-run `PipelineConfig` fields in contracts `arena.ts` and are settable
as baseline-only control fields in Arena comparisons through `BASELINE_ONLY_OPTIONS` in
`dimensions`:

- `approval_mode`: `auto`, the default, or `unless_trusted`. Unknown values fail closed
  to `unless_trusted` in `normalizeApprovalMode`.
- `sandbox_mode`: `off`, the default, or `os`. Unknown values fall back to `off` with a
  warning in `normalizeSandboxMode`, so containment is opt-in and never silently enabled.

With `sandbox_mode: os`, `agent-execution` attaches a sandbox hint to the workspace handed
to tools, where the writable root is the workspace root. `run` and `run_job` forward it
into every spawn. Nested runs inherit the config and therefore the hint.

## Boundaries

- Writes only. The restricted token does not restrict reads or network access. Network
  enforcement needs admin-level filters and is out of scope.
- Windows only. On other platforms `sandbox_mode: os` fails closed: the spawn layer
  refuses with an error instead of running unsandboxed.
- Visible failures over silent escapes. Commands that legitimately need writes outside
  the workspace, such as global installers or caches in `%APPDATA%`, fail with
  access-denied errors. Rerun such tasks with `sandbox_mode: off`.
- ACE lifetime. The capability ACE persists on the workspace root and on the descendants
  that existed at grant time until the directory is deleted, because workspaces are
  per-run scratch trees. A rehydrated old workspace carries the same deterministic SID,
  so the next spawn's grant is a no-op rather than an accumulation. The SID is
  reproducible by any same-user process; it is a DACL identity, not a secret.
- World-writable locations stay writable. `Everyone` is one of the restricting SIDs, so a
  path whose DACL grants World write access remains writable for the child. Windows
  default layouts do not grant that on user profiles or system directories, but shared or
  misconfigured volumes can, and the sandbox does not protect those locations.
- Links inside the workspace. Junctions and directory symlinks are skipped by the grant
  walk, so nothing behind them becomes writable through the workspace. Hard links cannot
  be created by a restricted child at all: `CreateHardLink` needs write access to the
  target, which the restricting SIDs deny for anything outside the workspace.
- Grant walk cost. Every spawn verifies the DACL of the root and each existing
  descendant. Already-granted entries are skipped but still read. A workspace with tens
  of thousands of files therefore adds metadata I/O to each spawn, and grant correctness
  takes priority over that cost.
- Out of scope. `bash_session` already fails closed on Windows; on POSIX it stays
  unsandboxed because the persistent shell is POSIX-only. MCP server child processes are
  not governed by this layer.
- The first sandboxed spawn pays a one-time C# compile of about 1 to 2 seconds. Later
  spawns load the cached assembly. A cached assembly is reused only while its C# source
  is unchanged; when the source changes the cached DLL is deleted before the new source
  is written, so a locked DLL keeps failing rather than silently running stale
  containment code.

## Tests

- Pure: `packages/environment/environment/tests/sandbox-launcher.test.ts` covers argv
  shape, refusals, and sentinel authentication. `packages/sandbox/sandbox/tests/` covers
  analysis, approval, and mode normalization.
- Real OS, skipped off Windows:
  `packages/environment/environment/tests/win-sandbox.real.test.ts` pins inside-root
  write success, outside-root access denial, junction containment, TEMP redirection,
  timeout kill-tree, and fail-closed setup. `run-tool.test.ts` covers the tool-level path
  end to end.
