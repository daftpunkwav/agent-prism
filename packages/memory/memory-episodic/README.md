# `@agentprism/memory-episodic`

Episodic memory: mini post-mortems of past task executions.

- `recordExperience` stores goal, tools, errors, self-correction, and outcome.
- `recallExperiences` returns the most relevant past experiences for a new task question.
- Near-identical reports for the same task are deduplicated.
- Optional `filePath` persistence and an injected clock in `EpisodicMemoryOptions`.

## Dependencies

- Runtime: `contracts / memory-store`.
