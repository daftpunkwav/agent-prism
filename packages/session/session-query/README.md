# `@agentprism/session-query`

Dependency-free query engine over the `SessionStore` port.

- `query`: text search, kind/status sets, time ranges, sorting, pagination.
- `aggregate`: counts by kind/status, entry histograms, activity windows.
- `exportDoc`: versioned export envelope assembly for backup/forensics.
- Depends on `contracts` session vocabulary; storage stays behind the port.
