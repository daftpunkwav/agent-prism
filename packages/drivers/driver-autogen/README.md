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

- Runtime: `contracts / driver-registry / harness / telemetry`.
