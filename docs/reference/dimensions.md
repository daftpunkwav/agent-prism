# Dimensions and templates

Sources of truth: `DimensionIdSchema` in `packages/contracts/contracts/src/enums.ts`,
`DIMENSION_FIELD` in `packages/contracts/contracts/src/dimension-field.ts`, the option
modules in `packages/dimensions/dimensions/src/dimensions/`, and the templates in
`packages/arena/arena-routing/src/task-templates.ts`.

## The 16 dimensions

| Dimension | PipelineConfig field | Options, default in bold | Option source |
|---|---|---|---|
| `framework` | `framework` | **native**, langchain, langgraph, plan_execute, self_critique, autogen, crewai | runtime-synced from the driver registry |
| `prompt` | `prompt_profile` | **zero_shot**, few_shot, cot_prompt, structured, terse | static |
| `reasoning` | `reasoning` | **react**, cot_tool, tot, reflexion, self_consistency | derived from contracts `REASONING_MODE_META` |
| `context` | `context` | **sliding**, summary, vector, hybrid, tool_tail, token_budget, budget, checkpoint | static |
| `harness` | `harness` | **bare**, verify, reflect, self_evolve | static |
| `temperature` | `temperature` | **0**, 0.3, 0.7, 1, plus any custom value from 0 to 2 | static |
| `model` | `endpoint_id` | provider endpoints | runtime-synced from the provider catalog |
| `thinking` | `thinking_level` | **off**, low, medium, high | static |
| `thinking_budget` | `thinking_budget` | **0** (follow level), 2048, 8192, 16384, 32768, 65536, plus any custom value from 0 to 1 000 000 | static seeds, overwritten by provider sync (Anthropic Messages default endpoints only) |
| `max_steps` | `max_steps` | 5, **10**, 15, 20, plus any custom value from 1 to 100 000 or `unlimited` | static |
| `toolset` | `toolset` | **full**, edit_run, read_only | static |
| `mcp` | `mcp_policy` | **off**, fs, full | static |
| `skill` | `skill_policy` | off, **on_demand**, preloaded | static |
| `orchestration` | `orchestration` | **direct**, plan_first, goal_first | static |
| `memory` | `memory` | **none**, episodic, semantic, full | static |
| `history_mode` | `history_mode` | **minimal**, tool_summary, full | static |

Notes:

- Capability dimensions, namely prompt, reasoning, context, harness, and toolset, start
  empty in `STATIC_DIMENSION_OPTIONS` and are filled by
  `DimensionCatalog.syncCapabilityOptions` from registered plugins. Framework and model
  are overwritten by driver and provider sync. Startup fails fast if prompt, reasoning,
  context, harness, or toolset ends up empty.
- Baseline-only decode fields `top_p`, `frequency_penalty`, `presence_penalty`, and
  `max_output_tokens`, along with the safety control fields `approval_mode` and
  `sandbox_mode`, live in `BASELINE_ONLY_OPTIONS`.
- Numeric fields are free numeric inputs in both the baseline panel and the
  comparison-dimension lane picker. Decode parameters accept their `DECODE_FIELD_RANGES`
  span. `max_steps` accepts 1 to 100 000 plus the `unlimited` token, which is the
  sentinel `-1` for no step budget; LangChain and LangGraph bound the graph at a
  200 000-step ceiling while Native runs unbounded until the model stops calling tools or
  the run is aborted. Custom lane values are accepted by `DimensionRouter.route` for
  numeric dimensions and fail with `422` when out of range.
- Per-value option semantics are documented in the in-app guide under `/guide` in
  `apps/web/src/i18n/content/guide/`.

## Run request constraints

- `question` is 1 to 4000 characters. `selections` is at most 16 with a minimum of 1
  column from `ARENA_MIN_SELECT`. The UI may sit at zero selections, showing an empty
  state with the run disabled. `attachments` is at most 5, each at most 64 KiB of text.
- Matrix requests carry 1 to 8 cells, each `{template_id, dimension?, selections,
  baseline?}`.

## Task templates in `task-templates.ts`

Each template has `id`, `name`, `description`, `question`, `suggested_dimension`,
`suggested_selections`, a `JudgeSpec` of type `keyword`, `json`, `code`, `numeric`,
`exclude`, `regex`, or `none`, and a category. `scored` templates have deterministic
judges, and `quick` templates are for smoke runs.

Scored, 15: `json_profile`, `arithmetic_mix`, `prime_count`, `fibonacci_code`,
`builtin_types`, `no_refusal`, `time_until_midnight`, `snake_game`, `string_reverse`,
`mcp_fs_probe`, `skill_commit_format`, `orchestration_two_files`, `loop_prime_race`,
`terse_factorial`, `context_long_tail`.

Quick, 11: `quick_time`, `quick_calc`, `quick_multi_time`, `quick_factorial`,
`quick_files`, `quick_code_file`, `quick_primes`, `quick_fibonacci`, `quick_summarize`,
`quick_pipeline`, `quick_plan`.

`GET /api/arena/templates` lists them. `POST /api/arena/judge` re-judges answers against
a template's spec. `scripts/run-matrix.mjs` runs all scored templates by default.

## Judging semantics in `evaluation/judging.ts`

- Empty answers fail outright, except under the `none` judge.
- `numeric` extracts the first number with commas stripped and applies `operator` and
  `tolerance`. `json` requires a top-level object with `required_fields`. `code` enforces
  `must_contain` and `max_len` on the first fenced block. `keyword` uses `any_of` and
  `all_of` with deduplicated `min_hits`. `exclude` fails on any pattern hit. `regex` is
  capped at 500-character patterns and tests only the first 2000 answer characters as a
  ReDoS guard.

## Ablation rows from contracts `AblationRow`

`label`, `tool_calls`, `mcp_calls`, `mcp_share`, `skill_reads`, `delegations`,
`reflects`, `observation_chars`, `answer_chars`, `judge_passed`, and `success`. They are
counted deterministically from the event stream in `evaluation/ablation.ts`.
`judge_passed` is `boolean` or `null`, and is null when no judge input is supplied, which
gives a behavior portrait rather than a score.
