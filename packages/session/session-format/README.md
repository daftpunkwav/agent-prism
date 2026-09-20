# `@agentprism/session-format`

Versioned session document envelopes with migration chain and validation.

- `envelope`: `{version, record, entries}` document shape with filename rules.
- `migrate`: v1 to v2 migration with summary, metadata, and entryCount backfill; unknown versions throw.
- `validate`: structural validation with fail-closed error taxonomy.
- Depends on `contracts` session vocabulary.
