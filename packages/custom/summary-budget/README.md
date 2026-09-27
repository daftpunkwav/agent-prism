# @agentprism/summary-budget

A **custom comparison dimension**: how much room the summary context strategy
keeps. Compare `2k` / `5k` / `8k` estimated tokens of digested history on the
same task, in the Arena, with the full pipeline, events, wire traces, and report.

```
Arena → dimension "summary_budget"     Builder → block "Summary budget"
  2k tokens                              2k tokens
  5k tokens  (default)                   5k tokens  (default)
  8k tokens                              8k tokens
```

## What it changes

`summary` and `hybrid` condense older turns into one system message whose size is
capped by `ContextTuning.summaryMaxChars` — a *character* budget (default 4000).
This dimension makes that cap the axis:

| Value | Effect |
|---|---|
| `2000` | 2 000 estimated tokens of digest (≈8 000 chars at the default divisor) |
| `5000` | 5 000 estimated tokens (default) |
| `8000` | 8 000 estimated tokens: keeps the most older detail, costs more per call |

Token values are converted with the run's own `charsPerToken`, so the axis keeps
its meaning when an operator retunes the divisor for CJK-heavy labs.

Only the `summary`/`hybrid` context strategies consult this budget: on the other
strategies the dimension is a no-op (the column then differs only by its prompt
tag). Compare it against `summary` or `hybrid` columns.

## Hook used

`contextTuning(value, base)` → a per-run patch of the context budgets. Reach: every
driver that applies the shared context pipeline (all but `openai_agents` and
`claude_agent_sdk`, which own their loop).

## Use it

Registered at the composition root (`apps/server/src/assemble.ts`) together with
the other `packages/custom/*` dimensions; `ARENA_CUSTOM_DIMENSIONS=off` disables
all of them. Nothing else to configure: the axis appears in `/api/arena/meta`, on
the Arena dimension card, in the Builder palette, and in the baseline panel as
`custom.summary_budget`.

## Copy it

This package is the reference implementation. To build your own dimension: copy
this directory, rename the package/id/options, and swap the hook — see
[`docs/reference/add-a-custom-dimension.md`](../../../docs/reference/add-a-custom-dimension.md)
(the four hook slots, the driver coverage table, and the rules).

## Dependencies

- Runtime: `contracts` only (the descriptor types). The host registers the dimension.
