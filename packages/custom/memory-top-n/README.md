# @agentprism/memory-top-n

A **custom comparison dimension**: how many recalled cross-session memories reach
the prompt. Compare "top 3" / "top 10" / "everything recalled" on the same task.

```
Arena → dimension "memory_top_n"        Builder → block "Memory recall depth"
  top3                                    top3  (default)
  top10                                   top10
  all                                     all
```

## What it changes

Memory mounting caps lines per layer (`MEMORY_BLOCK_LIMITS`, 3 episodic / 5
semantic) — a fixed budget that silently truncates a richer recall. This dimension
makes that budget the axis:

| Value | Effect |
|---|---|
| `top3` | Mount the first 3 entries per layer (tightest context, default) |
| `top10` | Mount the first 10 entries per layer |
| `all` | Mount every recalled entry (widest context) |

Compare it with the column's `memory` block set to `episodic`, `semantic`, or
`full`: with `memory=none` nothing is recalled, so there is nothing to shape.

## Hook used

`memory(input, value)` → the recall result and/or the render caps. Both halves are
needed: the caps alone cannot widen a recall the service already limited, and a
recall-wide slice alone is truncated again at render time. Reach: every driver
(memory is mounted during prompt assembly).

## Use it

Registered at the composition root (`apps/server/src/assemble.ts`) together with
the other `packages/custom/*` dimensions; `ARENA_CUSTOM_DIMENSIONS=off` disables
all of them. The axis then appears in `/api/arena/meta`, on the Arena dimension
card, in the Builder palette, and in the baseline panel as `custom.memory_top_n`.

## Copy it

Reference implementation for a dimension that shapes prompt-mounted state rather
than the message list — see
[`docs/reference/add-a-custom-dimension.md`](../../../docs/reference/add-a-custom-dimension.md).
