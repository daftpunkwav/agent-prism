# arena/

The experiment-execution layer for multi-column parallel comparison. `arena-routing` routes dimension configs into executable pipelines (pure config semantics, no execution dependency); `arena-runner` drives multi-column parallel runs. Heavy execution dependencies (`agent`) live only in the runner leaf.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`arena-routing/`](arena-routing/README.md) | Dimension routing and baselines: `DimensionRouter`, `ProviderDimensionSync`, baselines/fields/templates, capability-option projection | Consumed by the runner and the composition root |
| [`arena-runner/`](arena-runner/README.md) | Parallel multi-column execution: `ArenaRunner` and the column-factory port | Consumed by application services and the composition root |
