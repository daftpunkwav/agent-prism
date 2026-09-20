# `@agentprism/session-persistence`

File backend: `FileSessionStore` persists through the `JsonFile` port (single-version document, whole-file atomic writes, read-side schema validation and truncation). Corrupt files boot from empty (`persistence` first attempts `.bak` recovery); `active` sessions left over from a previous process flip to `failed` on load (only this process owns execution state).

## Dependencies

- Runtime: `contracts / persistence / session`.
