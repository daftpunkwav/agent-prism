# `@agentprism/sandbox`

Review-time shell safety policy: the static analysis and approval decisions that run before a
shell tool (`bash`, `run_job`, `bash_session`) executes.

## Modules

| Module | Responsibility |
|---|---|
| `command-analysis.ts` | `LayeredSandboxPolicy`, the default policy: quote-aware parsing into segments, command substitutions reviewed wherever a shell runs them (including inside double quotes), and interpreter wrappers (`bash -lc`, `cmd.exe /c`, PowerShell `-Command`/`-EncodedCommand`) re-parsed and judged recursively. Denies deliberate destruction of protected roots, block devices, formatting, and fork bombs. `isKnownSafeCommand` is the read-only allowlist behind the approval gate. |
| `sandbox-policy.ts` | Policy seam re-exports, the legacy quote-unaware `DenyListSandboxPolicy` (compatibility), the explicit `AllowAllSandboxPolicy` opt-out, and `toBeforeExecute`, the registry hook adapter for the three shell-carrying tools. |
| `approval.ts` | `ApprovalGate` and `normalizeApprovalMode`: `unless_trusted` lets only known-safe read-only commands run without approval; unknown modes fail closed to it. |
| `sandbox-mode.ts` | `normalizeSandboxMode`: `off` (default) or `os`; unknown values fall back to `off` with a warning, so OS containment stays opt-in. |
| `removal-targets.ts` | Shared removal-target normalization and the protected POSIX/Windows root sets both deny policies compare against. |

The static layers are a guardrail, not a security boundary: unclassifiable commands fail open,
and interpreters that take arbitrary code (`python -c`, `node -e`) are out of static reach. OS
write containment lives in `@agentprism/environment`; the full model is
[docs/architecture/sandbox-layers.md](../../../docs/architecture/sandbox-layers.md).

## Dependencies

- Runtime: `contracts` only.
