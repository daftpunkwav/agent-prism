# `@agentprism/session-outline`

Turn-outline projection over arena event streams.

- `projection`: pure fold of turn-segmented events into per-turn outlines
  (prompt preview, response preview, tool calls, verdict) with rail budgets.
- Preview budgets mirror the UI clamps so turns read identically before and
  after their events load.
- Depends on `contracts` event vocabulary (types only).
