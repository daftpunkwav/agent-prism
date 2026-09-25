# `@agentprism/driver-plan-execute`

Plan-Execute framework driver: a planner pass writes numbered steps (no tools),
then an executor ReAct loop works the plan with one budgeted replan on stall.

- `frameworkId: plan_execute`, banner `[Plan-Execute]`.
- Planner/replan deliberation rides `reflect` events so answer extraction stays clean.
- Consumes only the harness seam (`buildSystemUser`, `applyContextPipeline`) plus
  `driver-run-support` run support; no imports from other driver leaves.
