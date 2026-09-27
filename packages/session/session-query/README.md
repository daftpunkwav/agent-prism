# `@agentprism/session-query`

Dependency-free query engine over the `SessionStore` port.

- `query`: text search, kind/status sets, time ranges, sorting, pagination.
- `aggregate`: counts by kind/status, entry histograms, activity windows.
- `exportSessionDocument`: versioned export envelope assembly for backup/forensics.
- Depends on the `contracts` session vocabulary and `session-format`; storage stays behind the port.
