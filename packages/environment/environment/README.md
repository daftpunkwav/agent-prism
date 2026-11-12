# `@agentprism/environment`

Sandboxed filesystem and child-process execution: the filesystem and process side of the
runtime trust boundary. Depends only on `contracts`.

## Modules

| Module | Responsibility |
|---|---|
| `scoped-filesystem.ts` | `ScopedFileSystem`: every path canonicalizes into one root (traversal, control characters, Windows device names); symlink/junction escapes are refused on read, write, edit, delete, and listing. Reads can be byte-windowed (`readFileHead`) and snapshot exports budgeted (`snapshotFiles`). Violations fail closed with `WorkspaceError`. |
| `process-runner.ts` | `runProcess` (one-shot with timeout and abort), `spawnBackground` (caller-owned lifetime), and `spawnPersistentShell` (POSIX only). Spawns without a shell through the `childProcessEnv` allowlist, so host secrets, proxy credentials, and other non-allowlisted variables never reach a child; per-stream output caps bound memory use. A kill this module issued owns the outcome: a child that traps SIGTERM and exits zero is still `timeout`/`aborted`, never `ok`. |
| `sandbox-launcher.ts` | The `sandbox_mode: os` spawn transform: rewrites argv into the restricted-token helper and maps the helper's nonce-authenticated setup-failure sentinel to a process error. Unenforceable requests (non-Windows host, not exactly one writable root) are refused instead of running unsandboxed. |
| `win-sandbox-helper.ts` | Sources of the materialized PowerShell driver and its C# P/Invoke body: per-root capability ACE, write-restricted token, job object with kill-on-close, TEMP/TMP redirection into the writable root. Windows only. |

Writes are the only OS-restricted operation: reads and network are unaffected by the sandbox
layer. The enforcement model and its boundaries are documented in
[docs/architecture/sandbox-layers.md](../../../docs/architecture/sandbox-layers.md).

## Dependencies

- Runtime: `contracts`.
