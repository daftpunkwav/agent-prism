# `@agentprism/session-persistence`

Durable `SessionStore` backends. Both share the same mutation semantics (caps, sanitization, stale-active migration to `failed`, newest-first ordering) and differ only in durability mechanics:

- `FileSessionStore` (`file-session-store.ts`): one versioned JSON document through the `JsonFile` port; every mutation rewrites the whole ledger atomically.
- `JsonlSessionStore` (`jsonl-session-store.ts`): append-only op log plus whole-state snapshots through `AppendFile` / `JsonFile`. O(1) appends, `checkpoint()` rewrites snapshot then truncates the log (replay is idempotent), corrupt log lines are counted and skipped (`corruptLines`), and appended bytes past a budget trigger an automatic checkpoint. Replay rejects a JSON-valid but type-corrupt line (non-finite `at`, non-integer or negative `seq`, non-object `metadata`) through the same corrupt-line accounting as an unparsable line.

Shared load rules: corruption is contained per session item on both backends (one malformed record never wipes the ledger); the JSONL backend refuses to partially interpret a snapshot whose container version is unknown, while the file backend keeps its tolerant recovery path (unknown versions still load through the same per-item containment). Oversized entries spill to the `SessionBlobStore` sidecar (`FileBlobStore`), whose filenames sanitize the session id, hash it so colliding sanitized ids stay distinct, and reject a non-safe-integer sequence instead of embedding it in a path; on platforms that honor POSIX modes the sidecar writes owner-only (`0o600`) in a `0o700` directory.

## Dependencies

- Runtime: `contracts / persistence / session`.
