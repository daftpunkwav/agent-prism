# `@agentprism/driver-crewai`

CrewAI-pattern framework driver: a role crew running a task pipeline.

- `CrewAIDriver`, `frameworkId "crewai"`.
- Sequential pipeline of research, implement, and verify tasks with role workers.
  `ARENA_CREWAI_PROCESS=hierarchical` switches to the manager process.
- Task boundaries and manager delegations ride `reflect` events; worker thoughts carry the
  answer, and the pipeline ends on the reviewer's turn.
- `max_steps` budgets every crew LLM call, and `taskTurnCapFor` grants one extra turn per
  task under reflexion.
- Faithful-pattern implementation of CrewAI's crew, task, and process model on the arena's
  shared ports; not vendor code.

## Dependencies

- Runtime: `contracts / driver-run-support / harness / telemetry`.

## Runtimes

This driver runs on two interchangeable backends, selected per column run:

- **Python bridge (real CrewAI)** — default when a Python interpreter with the
  `crewai` package is available. `python/bootstrap.py` runs a real `Crew`
  (researcher/coder/reviewer, `ARENA_CREWAI_PROCESS` picks sequential vs
  hierarchical) and talks to the host over NDJSON: every model completion
  round-trips to the arena model port and every tool call executes through the
  arena tool registry, so credentials never leave the host process and tool
  policy/logs/budgets apply unchanged. Install:
  `pip install -r python/requirements.txt` into the interpreter that
  `ARENA_PYTHON` points at (default `python`, then `python3`). Probe results
  are cached for the server process lifetime — restart the runtime after
  installing the framework.
- **TypeScript pattern fallback** — used when the probe fails. Neutral-transcript
  crew pipeline (sequential and hierarchical manager delegation); same events,
  same budgets.

`ARENA_CREWAI_RUNTIME` forces a side: `python` (fail closed when unavailable),
`ts` (skip the probe), or `auto` (default).
