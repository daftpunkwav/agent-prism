# `@agentprism/builder-service`

Builder service: session lifecycle, catalog, hot-swaps. Orchestrates turn execution from `builder-turns`; tool definitions reach it through the injected catalog sources.

## Dependencies

- Runtime: `contracts / persistence / runtime / builder-turns` (`tool-builtins` is a dev dependency, used by the tests).
