# `@agentprism/builder-service`

Builder service: session lifecycle, catalog, hot-swaps. Orchestrates turn execution from `builder-turns`; tool definitions reach it through the injected catalog sources.

- One turn per session: the run handle is taken before the first chunk and released in one
  `finally`, so a consumer that disconnects right after the first chunk (SSE client gone) cannot
  leave the session stuck as "running".
- A detached turn's execution-ledger row is closed as `cancelled`; ledger failures warn and never
  break the turn they observe.
- `patchComposition` validates the whole patch (idle guard, composition normalization, block
  availability) before mutating, so a rejected patch applies neither its name nor its composition.
- Session records plus history persist through `BuilderSessionStore` (debounced atomic writes);
  the per-session observability journal persists through `SessionTraceStore` (JSONL).

## Dependencies

- Runtime: `contracts / persistence / runtime / builder-turns` (`tool-builtins` is a dev dependency, used by the tests).
