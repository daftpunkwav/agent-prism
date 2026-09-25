# `@agentprism/driver-autogen`

AutoGen-pattern framework driver: a conversable group chat with LLM speaker selection.

- `AutogenDriver`, `frameworkId "autogen"`.
- Coder and reviewer roles run in rounds; the user proxy executes tool calls.
- Selections and critiques ride `reflect` events, so coder thoughts carry the answer.
- `max_steps` budgets every group-chat LLM call, selection and speaker turns alike.
- `reviewerBudgetFor` grants one extra reviewer round under reflexion.
- Faithful-pattern implementation of AutoGen's group-chat model on the arena's shared
  ports; not vendor code.

## Dependencies

- Runtime: `contracts / driver-run-support / harness / telemetry`.

## Runtimes

This driver runs on two interchangeable backends, selected per column run:

- **Python bridge (real AutoGen)** — default when a Python interpreter with the
  `autogen_agentchat` package is available. `python/bootstrap.py` runs a real
  `RoundRobinGroupChat` (coder + reviewer, `TERMINATE` termination) and talks to
  the host over NDJSON: every model completion round-trips to the arena model
  port and every tool call executes through the arena tool registry, so
  credentials never leave the host process and tool policy/logs/budgets apply
  unchanged. Install: `pip install -r python/requirements.txt` into the
  interpreter that `ARENA_PYTHON` points at (default `python`, then `python3`).
  Probe results are cached for the server process lifetime — restart the
  runtime after installing the framework.
- **TypeScript pattern fallback** — used when the probe fails. Neutral-transcript
  group-chat loop with LLM speaker selection; same events, same budgets.

`ARENA_AUTOGEN_RUNTIME` forces a side: `python` (fail closed when unavailable),
`ts` (skip the probe), or `auto` (default).
