# Custom comparison dimensions

One package here = one comparison dimension. Each declares its values and the hook
that makes a value take effect; registered at the composition root
(`apps/server/src/assemble.ts`), it becomes an Arena axis, a Builder block, and a
pinnable baseline field — no frontend change required.

| Package | Axis | Hook | Compares |
|---|---|---|---|
| [`summary-budget`](summary-budget/README.md) | `summary_budget` | `contextTuning` | How much digested history the summary strategy keeps (2k / 5k / 8k tokens) |
| [`memory-top-n`](memory-top-n/README.md) | `memory_top_n` | `memory` | How many recalled memories reach the prompt (top 3 / top 10 / all) |
| [`tool-replay`](tool-replay/README.md) | `tool_replay` | `messages` | Which past tool results replay (all / skip read results / writes only) |

Every package carries its own README (English + `.zh.md`) with the value table, the
hook it uses, and its limits — a new dimension needs no changes anywhere else in
the tree, and reading one package tells you everything about it.

## Add one

Copy an existing package, rename the id and options, swap the hook, register it,
and add the workspace dependency to `apps/server/package.json`. The full recipe,
the four hook slots, the driver coverage table, and the constraints live in
[`docs/reference/add-a-custom-dimension.md`](../../docs/reference/add-a-custom-dimension.md).

## Disable them

`ARENA_CUSTOM_DIMENSIONS=off` disables every dimension here at once (nothing is
registered, no projection row is emitted).
