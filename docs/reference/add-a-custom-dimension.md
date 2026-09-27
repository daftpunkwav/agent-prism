# Custom comparison dimensions

A custom comparison dimension is **one package under `packages/custom/<name>`**.
The package declares the values the dimension can take and how a value takes
effect; registering it at the composition root makes it:

- an **Arena comparison axis** — its own dimension card, lanes, baseline field,
  events, wire traces, logs, and report (the whole pipeline, no special-casing);
- a **Builder block** — a slot in the palette, saved with the session, hot-swappable;
- a **pinnable baseline field** — `custom.<id>` in the baseline panel, so it can be
  held fixed while another axis is compared.

No frontend code changes are required for any of that.

```
packages/custom/summary-budget/        one dimension = one package
  README.md                            what it compares, which hook it uses
  package.json                         @agentprism/<name>, depends on contracts
  src/index.ts                         exports one CustomDimension descriptor
  tests/                               the dimension's own tests
```

The repository ships three worked examples: `summary-budget` (`contextTuning` hook),
`memory-top-n` (`memory` hook), and `tool-replay` (`messages` hook).

## The descriptor

```ts
import type { CustomDimension } from "@agentprism/contracts";

export const myDimension: CustomDimension = {
  id: "my_dimension",                       // lower_snake_case; the axis id + Builder block custom:my_dimension
  label: "My dimension",                    // English canonical; localized in the web i18n when keys exist
  subtitle: "One line on the Arena card",
  options: [
    { value: "a", label: "A", description: "What a means" },
    { value: "b", label: "B" },
  ],
  default: "a",                             // must be one of options (defaults to the first)
  promptHint: "\n[Context: my dimension = {value}]",   // {value} is substituted
  hooks: { /* see below */ },
};
```

A descriptor with no hooks is legal: the column then differs only by its prompt tag.

`default` is the value in force when nothing else overrides it: the Builder highlights it,
a Builder composition that never touched that block still runs under it, and the Arena
baseline panel offers it as the `custom.<id>` field default. An explicit Builder choice or
baseline pin wins; omitting `default` falls back to the first option.

## The four hooks

Each slot maps to a seam that already existed in the run pipeline. Hooks are pure
shaping over framework-neutral values — no vendor SDK, no IO, and no ambient clock
(a dimension must behave identically in every column).

| Hook | Runs at | Reach | Use it for |
|---|---|---|---|
| `contextTuning(value, base)` | Run assembly, before the context strategy | Every driver applying the shared context pipeline | Sizing a strategy's own budget (summary digest, windows, token pools) |
| `messages(input, value)` | After the context strategy, before pair safety + sanitize + grounding | Same as above | Which parts of the transcript the model sees, and how much; masking tool output |
| `prompt(input, value)` | End of prompt assembly, on the composed system/user halves | **Every framework** | Adding, rewriting, or stripping prompt text (grounding lines, policy copy) |
| `memory(input, value)` | Prompt assembly, before the memory block is rendered | **Every framework** | How many recalled memories are mounted; which ones |

Two consequences worth knowing:

- `prompt` and `memory` also reach `openai_agents` and `claude_agent_sdk` (those
  drivers assemble prompts but own their own loop). `contextTuning` and `messages`
  do not: on those two columns a message-level dimension is a no-op, so its columns
  show no difference there. That is factual behaviour, not a bug — cite it when a
  comparison looks flat. The same limitation applies to the builtin `context`
  dimension itself (those two drivers never call the shared context pipeline), so
  neither a custom strategy-shaped dimension nor a builtin context strategy
  isolates anything on those columns.
- `messages` may delete results: the shared pair-safety pass then drops the
  orphaned tool call too. Prefer replacing a result with a marker when you want to
  keep the call visible.

Hooks fold in **registration order**; a hook returning `undefined` (or an empty
patch) changes nothing.

## Recipe

1. **Create the package** (`packages/custom/<name>` — copy a shipped example):

   ```jsonc
   // package.json
   { "name": "@agentprism/<name>", "type": "module", "private": true,
     "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
     "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit" },
     "dependencies": { "@agentprism/contracts": "workspace:*" } }
   ```

   plus the standard leaf `tsconfig.json` (extends `../../../tsconfig.base.json`).

2. **Export the descriptor** from `src/index.ts` (see above).

3. **Register it** in `apps/server/src/assemble.ts`:

   ```ts
   registerCustomDimensions([...existing, myDimension]);
   ```

   and add `"@agentprism/<name>": "workspace:*"` to `apps/server/package.json`.
   Registration is gated by `ARENA_CUSTOM_DIMENSIONS=off`.

4. **`pnpm install`**, rebuild, restart. `pnpm typecheck` and
   `node scripts/check-boundaries.mjs` must stay green.

5. **Write the README** (English + `.zh.md`, like the shipped examples): what it
   compares, the value table, which hook it uses, and its limits. Each custom
   dimension carries its own documentation, so the next reader never has to dig
   through the framework.

## Constraints and failure modes

- **Ids**: `^[a-z][a-z0-9_]{0,63}$`. Registration rejects a padded id, a blank
  label, an empty or duplicated option list, an option value longer than 200
  characters (the bound every persisted config record applies), a `default` outside
  `options`, an id that collides with a builtin dimension or with a builtin context
  strategy (the run's effectiveness rows would merge with that strategy's), and a
  second package claiming a registered id — all at startup, never at run time.
- **Unknown ids fail loudly** at three points: configure time (Builder
  composition), baseline resolution (a pin naming a dimension no package provides),
  and run assembly (a stored thread whose package was removed). Nothing silently
  runs a different experiment.
- **Values are validated against the live registry** in the Builder and in the
  baseline; the run request accepts any axis token and the router rejects unknown
  ones with `422` before the stream opens.
- **Threads and Builder compositions** carry custom values like every other block
  (`PipelineConfig.custom`), so they survive restarts with the session.
- **Localized labels**: without a frontend catalog key the English `label` is
  shown (the same fallback every dynamic option uses). Add
  `dimensions.field.<id>` / `dimensions.opt.<id>.<value>` keys to
  `apps/web/src/i18n/catalogs/*/dimensions.ts` if you want translations.
- **In-app guide** (`/guide`) documents the 16 builtin dimensions only; a custom
  dimension is documented by its own package README.

## Turning custom dimensions off

Set `ARENA_CUSTOM_DIMENSIONS=off` in the environment (or the root `.env`): nothing
is registered and no projection row is emitted, so the Arena falls back to the
builtin axes only. Existing configs that pinned a custom value then fail loudly
(see above) rather than running with it silently dropped.

## Related

- `docs/reference/dimensions.md` — the builtin dimensions and their option sources.
- `docs/guides/add-a-dimension.md` — adding a *top-level builtin* dimension
  (enum + field + driver), which is a different, much larger change.
