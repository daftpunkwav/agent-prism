# Comparison dimensions

A dimension is one variable axis of comparison. The current set has 16 ids in
`DimensionIdSchema` in `packages/contracts/contracts/src/enums.ts`: framework, prompt,
reasoning, context, harness, temperature, model, thinking, thinking_budget, max_steps,
toolset, mcp, skill, orchestration, memory, and history_mode.

## Vocabulary

The id is added to `DimensionIdSchema` and mapped to its `PipelineConfig` field in
`DIMENSION_FIELD` in `packages/contracts/contracts/src/dimension-field.ts`. Identity
mapping is the common case. Precedents are `mcp` to `mcp_policy`, `skill` to
`skill_policy`, and `prompt` to `prompt_profile`.

## Option catalog

`packages/dimensions/dimensions/src/dimensions/<name>.ts` holds the option table of
`value` and label plus the default, following `mcp.ts`, `skill.ts`, or
`orchestration.ts`. Two flavors exist:

- Static options are listed directly in the catalog and serve /meta as-is: temperature,
  thinking, thinking_budget, max_steps, mcp, skill, orchestration, memory, and
  history_mode.
- Registry-gated options start empty in `STATIC_DIMENSION_OPTIONS` and are filled at
  startup by the capability sync: `buildCapabilityOptionProjection` filters the static
  tables down to the live registry, and the router's `syncCapabilityOptions` applies the
  result — prompt, reasoning, context, harness, and toolset. `framework` (driver registry)
  and `model` (provider endpoints) carry static seed rows that driver/provider sync
  overwrites instead.

A dimension with a default registers it in `STATIC_DEFAULT_BASE`.

## Semantics

The dimension changes one thing per column.

- Prompt profiles ride the prompt section registry as `profile:<name>`.
- Policies such as mcp, skill, and orchestration alter the tool table or system prompt
  through the execution context.
- Baseline decode fields used only by baselines go in `BASELINE_ONLY_OPTIONS`, following
  `top_p`, `frequency_penalty`, `presence_penalty`, and `max_output_tokens`.

A selection isolates exactly this dimension's effect.

Why this is not the path for every comparison idea: a **custom dimension package**
(`packages/custom/<name>`) declares a whole new axis — its values, its hook, its
Builder block, and its baseline field — without touching the enum, the field table,
or any driver. Use it whenever the variation can be expressed by a dimension hook;
use this guide only when the axis must be a first-class builtin. See
[../reference/add-a-custom-dimension.md](../reference/add-a-custom-dimension.md).

## Inherited surfaces

`DIMENSION_FIELD` drives routing and baseline passthrough. `/api/arena/meta` exposes
options automatically. `buildCapabilityOptionProjection` and templates pick up the
dimension without frontend hardcoding.

## Guide and i18n

The guide content in `apps/web/src/i18n/content/guide/{en,zh-CN}.ts` gains the dimension
entry. Labels go in `apps/web/src/i18n/catalogs/{en,zh-CN}/dimensions.ts`, where catalog
parity is gate-checked. FieldMatrix-style copy counts are updated in both locales.

## Tests and documentation

Options and defaults get unit tests in the dimensions leaf, and catalog parity runs under
`apps/web/tests`. The dimension row is added to
[../reference/dimensions.md](../reference/dimensions.md) and to the family table in
`packages/dimensions/README.md`.
