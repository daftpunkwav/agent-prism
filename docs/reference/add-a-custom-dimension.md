# Adding a Custom Comparison Dimension

A custom comparison dimension is a **subpackage**: you implement the backend
strategy, register it at the composition root, and the Arena frontend picks it
up automatically — the dimension card, the baseline field, and the legal-value
validation all come from the existing metadata pipeline. No frontend code
changes are required.

The repository ships a complete example:
`packages/context/context-assembly` — three context strategies that differ in
which tool-call results replay into the model context (all / skip read
results / mutating results only).

## How the pieces fit

```
your subpackage (packages/<area>/<your-dimension>)
  exports ContextStrategyPlugin[]            ← contracts/context-policy.ts
        │
        ▼ registerContextStrategyPlugins()   ← apps/server/src/assemble.ts (one line)
  harness policy registry                    ← strategies become selectable
        │
        ▼ buildCapabilityOptionProjection()  ← packages/arena/arena-dimensions
  meta endpoint → Arena baseline + dimension cards (auto)
```

## Recipe (context-strategy dimension)

1. **Create the subpackage** at `packages/<area>/<name>` (the
   `packages/*/*` workspace glob picks it up automatically):

   ```jsonc
   // package.json — name must start with @agentprism/
   { "name": "@agentprism/<name>", "type": "module",
     "dependencies": { "@agentprism/contracts": "workspace:*" } }
   ```

2. **Export the strategies** as `ContextStrategyPlugin[]`
   (`@agentprism/contracts`): each plugin has `id`, `label` (English
   fallback), optional `description`, and `apply(messages)` returning the
   transformed message list. Keep tool_call/tool_result pairing intact —
   replace unwanted results with a marker instead of deleting them. Sanitize
   and tool grounding run afterwards through the shared pipeline tail; do not
   reimplement them.

3. **Register at the composition root** (`apps/server/src/assemble.ts`):

   ```ts
   registerContextStrategyPlugins(yourPlugins);
   ```

   and add `"@agentprism/<name>": "workspace:*"` to `apps/server/package.json`.

4. **`pnpm install`**, rebuild, restart the server. The strategies appear in
   the **Context** dimension (after the six builtin rows) and are legal
   baseline values everywhere.

## Turning custom dimensions off

Set `ARENA_CUSTOM_DIMENSIONS=off` in the environment (or root `.env`): the
projection drops every plugin row and the server never registers them, so the
dimension falls back to the builtin strategies only.

## Notes and constraints

- Strategy ids must not collide with the reserved pipeline ids (`sliding`,
  `summary`, `vector`, `hybrid`, `tool_tail`, `token_budget`, `budget`,
  `checkpoint`): a colliding id would be dispatched to the builtin strategy
  instead of the plugin.
- Plugins are applied by the shared policy tail: sanitize + tool grounding
  always run, so custom strategies cannot leak unsafe tool output.
- Localized labels: without a frontend catalog key the English `label` is
  shown (the same fallback every dynamic option uses). Add
  `dimensions.context.<id>` keys to `apps/web/src/i18n/catalogs/*/dimensions.ts`
  if you want translations.
- New **top-level dimensions** (a brand-new id alongside `framework`,
  `context`, …) still require touching `contracts` (`DimensionIdSchema`,
  `DIMENSION_FIELD`, `PipelineConfigSchema`) plus a driver that consumes the
  field — the plugin seam above is the supported path for strategy-style
  variations inside an existing dimension.
