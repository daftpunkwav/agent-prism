# @agentprism/tool-replay

A **custom comparison dimension**: which past tool results replay into the model
context. Compare full replay / read results omitted / writes only.

```
Arena → dimension "tool_replay"         Builder → block "Tool-result replay"
  all                                     all  (default)
  skip_read                               skip_read
  writes_only                             writes_only
```

## What it changes

| Value | Effect |
|---|---|
| `all` | Replay every tool call with its full result (most faithful, most context) |
| `skip_read` | Replace read-only results (`read`/`glob`/`grep`/`ls`) with `[omitted: read-only tool result]` |
| `writes_only` | Keep only write-class results (`write`/`edit`/`apply_patch`/`bash`/`bash_session`/`run_job`); everything else becomes a marker |

Pairing is preserved by construction: an omitted result is **replaced by a marker**,
never deleted, so the assistant/tool pairing providers require stays valid on every
wire format. A hook that deletes results outright is repaired by the shared
pair-safety pass (the orphaned tool call is dropped too), which loses more than it
needs to.

In a parallel batch (one turn requesting several tools) each result is attributed
by its own tool name, so a read result is omitted even when a sibling call in the
same batch is kept.

## Hook used

`messages(input, value)` → the model-visible message list. It runs after the
context strategy and before the pair-safety pass, sanitize, and tool grounding.
Reach: every driver that applies the shared context pipeline (all but
`openai_agents` and `claude_agent_sdk`).

## Use it

Registered at the composition root (`apps/server/src/assemble.ts`) together with
the other `packages/custom/*` dimensions; `ARENA_CUSTOM_DIMENSIONS=off` disables
all of them. The axis then appears in `/api/arena/meta`, on the Arena dimension
card, in the Builder palette, and in the baseline panel as `custom.tool_replay`.

It occupies the same ground as a context strategy but is a **separate axis**: the
context dimension still chooses the trimming strategy, and this dimension chooses
what the strategy gets to trim. Comparing `tool_replay` therefore isolates one
variable instead of mixing it into the context rows.

## Migration note

Previously shipped as three context strategies pinned to the `context` dimension. A
replay-granularity choice is a comparison axis of its own, so it now contributes one
dimension — the context dimension keeps its six builtin strategies, and this dimension
absorbs the three former rows.

## Dependencies

- Runtime: `contracts` only (the descriptor types). The host registers the dimension.
