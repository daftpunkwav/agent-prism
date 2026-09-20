# builder/

Agent Builder: conversationally assembles pipelines. `builder-service` orchestrates sessions, the catalog, and hot-swaps; `builder-turns` executes turns (driving model calls through `agent`). Heavy execution dependencies (`agent`, `arena-view`) live only in the turns leaf.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`builder-service/`](builder-service/README.md) | Builder service: `BuilderService`, session store | Consumed by the transport layer and the composition root |
| [`builder-turns/`](builder-turns/README.md) | Turn execution: `runBuilderTurn`, composition, blocks, trace log, domain errors | Orchestrated by the service leaf |
