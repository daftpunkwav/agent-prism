# `@agentprism/context-budget`

Per-source token budgeting with priority allocation and ledgers.

- `sources`: named budget sources (system/instructions/tools/history/mentions/skills/retrieval) with weights.
- `allocate`: priority-ordered allocator that spends budgets and reports deficits in the ledger output.
- `ledger`: allocation ledger rendering for prompts (`[Budget ledger]` lines).
- Zero dependencies (pure arithmetic, deterministic).
