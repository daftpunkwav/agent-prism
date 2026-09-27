# `@agentprism/context-instructions`

Layered agent-instruction assembly (repo defaults + workspace overrides).

- `sources`: bundled instruction layers plus repo/workspace `AGENTS.md` discovery with precedence.
- `digest`: content hashing and change detection so re-rendering is pay-as-you-go.
- `render`: budget-aware section rendering with truncation markers.
- `state`: held instruction state with refresh-on-change semantics.
- No `@agentprism` dependencies: file access is structural, satisfied by the caller's workspace fs.
