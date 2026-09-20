# `@agentprism/session`

The `SessionStore` port lives in `contracts`, following `ToolRegistry` and `DriverLookup`. This leaf provides `InMemorySessionStore`, which applies the same validation as the file backend and suits tests and throwaway ledgers, plus the caps for title, entries, and session count that the file backend references from the same source.

## Dependencies

- Runtime: `contracts` only.
