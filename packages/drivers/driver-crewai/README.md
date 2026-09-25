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
