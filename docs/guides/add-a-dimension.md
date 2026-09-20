# Comparison dimensions

A dimension is one variable axis of comparison. The current set has 14 ids in
`DimensionIdSchema` in `packages/contracts/contracts/src/enums.ts`: framework, prompt,
reasoning, context, harness, temperature, model, thinking, max_steps, toolset, mcp, skill,
orchestration, and memory.

## Vocabulary

The id is added to `DimensionIdSchema` and mapped to its `PipelineConfig` field in
`DIMENSION_FIELD` in `packages/contracts/contracts/src/dimension-field.ts`. Identity
mapping is the common case. Precedents are `mcp` to `mcp_policy`, `skill` to
`skill_policy`, and `prompt` to `prompt_profile`.

## Option catalog

`packages/dimensions/dimensions/src/dimensions/<name>.ts` holds the option table of
`value` and label plus the default, following `mcp.ts`, `skill.ts`, or
`orchestration.ts`. Two flavors exist:

- Static options are listed directly: prompt, reasoning, context, harness, temperature,
  thinking, max_steps, toolset, mcp, skill, orchestration, and memory.
- Runtime-synced options start empty and are filled by
  `DimensionCatalog.syncCapabilityOptions` or provider sync at startup and on provider
  changes: `framework` from the driver registry and `model` from provider endpoints.

A dimension with a default registers it in `STATIC_DEFAULT_BASE`.

## Semantics

The dimension changes one thing per column.

- Prompt profiles ride the prompt section registry as `profile:<name>`.
- Policies such as mcp, skill, and orchestration alter the tool table or system prompt
  through the execution context.
- Baseline decode fields used only by baselines go in `BASELINE_ONLY_OPTIONS`, following
  `top_p`, `frequency_penalty`, `presence_penalty`, and `max_output_tokens`.

A selection isolates exactly this dimension's effect.

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
