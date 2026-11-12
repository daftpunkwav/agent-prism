# `@agentprism/persistence`

Atomic JSON file storage (tmp + `.bak` + rename, corrupt-source backup refusal, orphan tmp sweep) and append-only line files, with per-path async write serialization and a per-key serial task queue. Written files and newly created directories are owner-only on platforms that honor modes (`0o600`/`0o700`; Windows ignores them), because persisted documents can carry plaintext provider credentials. Zero @agentprism dependencies.

## Dependencies

- Runtime: none (leaf node).
