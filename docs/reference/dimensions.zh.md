# Dimensions 与 templates

> 语言：**简体中文** | [English](dimensions.md)

事实来源：`packages/contracts/contracts/src/enums.ts` 中的 `DimensionIdSchema`，
`packages/contracts/contracts/src/dimension-field.ts` 中的 `DIMENSION_FIELD`，
`packages/dimensions/dimensions/src/dimensions/` 中的选项模块，以及
`packages/arena/arena-dimensions/src/task-templates.ts` 中的 templates。

## 16 个 dimensions

| Dimension | PipelineConfig 字段 | 选项，默认值加粗 | 选项来源 |
|---|---|---|---|
| `framework` | `framework` | **native**、langchain、langgraph、plan_execute、self_critique、autogen、crewai | 从 driver registry 运行时同步 |
| `prompt` | `prompt_profile` | **zero_shot**、few_shot、cot_prompt、structured、terse | static |
| `reasoning` | `reasoning` | **react**、cot_tool、tot、reflexion、self_consistency | 从 contracts `REASONING_MODE_META` 派生 |
| `context` | `context` | **sliding**、summary、vector、hybrid、tool_tail、token_budget、budget、checkpoint | static |
| `harness` | `harness` | **bare**、verify、reflect、self_evolve | static |
| `temperature` | `temperature` | **0**、0.3、0.7、1，以及 0 至 2 的任意自定义值 | static |
| `model` | `endpoint_id` | provider endpoints | 从 provider catalog 运行时同步 |
| `thinking` | `thinking_level` | **off**、low、medium、high | static |
| `thinking_budget` | `thinking_budget` | **0**（跟随 level）、2048、8192、16384、32768、65536，以及 0 至 1 000 000 的任意自定义值 | static 种子，由 provider sync 覆盖写（仅限 Anthropic Messages 默认 endpoint） |
| `max_steps` | `max_steps` | 5、**10**、15、20，以及 1 至 100 000 的任意自定义值或 `unlimited` | static |
| `toolset` | `toolset` | **full**、edit_run、read_only | static |
| `mcp` | `mcp_policy` | **off**、fs、full | static |
| `skill` | `skill_policy` | off、**on_demand**、preloaded | static |
| `orchestration` | `orchestration` | **direct**、plan_first、goal_first | static |
| `memory` | `memory` | **none**、episodic、semantic、full | static |
| `history_mode` | `history_mode` | **minimal**、tool_summary、full | static |

备注：

- 能力类 dimension，即 prompt、reasoning、context、harness、toolset，在
  `STATIC_DIMENSION_OPTIONS` 中起始为空，由 `DimensionCatalog.syncCapabilityOptions`
  从已注册 plugin 填充。framework 与 model 由 driver 与 provider sync 覆盖写。若
  prompt、reasoning、context、harness、toolset 最终为空，启动快速失败。
- 仅 baseline 的 decode 字段 `top_p`、`frequency_penalty`、`presence_penalty`、
  `max_output_tokens`，以及安全控制字段 `approval_mode` 与 `sandbox_mode`，位于
  `BASELINE_ONLY_OPTIONS`。
- 数值字段在 baseline 面板与对比 dimension lane 选择器中都是自由数值输入。decode
  参数接受其 `DECODE_FIELD_RANGES` 范围。`max_steps` 接受 1 至 100 000，以及
  `unlimited` token，后者是哨兵 `-1`，表示无 step 预算；LangChain 与 LangGraph 把图
  限制在 200 000 step 上限，而 Native 无界运行直到模型停止调用 tool 或 run 被中止。
  自定义 lane 值由 `DimensionRouter.route` 对数值 dimension 接受，超出范围时以
  `422` 失败。
- 每个取值的选项语义记录在应用内 guide，位于 `/guide` 与
  `apps/web/src/i18n/content/guide/`。

## Run 请求约束

- `question` 为 1 至 4000 字符。`selections` 至多 16 个，最少 1 列，见
  `ARENA_MIN_SELECT`。UI 可以停在零选择，显示空状态并禁用 run。`attachments` 至多
  5 个，每个至多 64 KiB 文本。
- Matrix 请求携带 1 至 8 个 cell，每个为
  `{template_id, dimension?, selections, baseline?}`。

## `task-templates.ts` 中的任务模板

每个 template 含 `id`、`name`、`description`、`question`、`suggested_dimension`、
`suggested_selections`、类型为 `keyword`、`json`、`code`、`numeric`、`exclude`、
`regex` 或 `none` 的 `JudgeSpec`，以及一个分类。`scored` 模板有确定性 judge，
`quick` 模板用于冒烟 run。

Scored，15 个：`json_profile`、`arithmetic_mix`、`prime_count`、`fibonacci_code`、
`builtin_types`、`no_refusal`、`time_until_midnight`、`snake_game`、`string_reverse`、
`mcp_fs_probe`、`skill_commit_format`、`orchestration_two_files`、`loop_prime_race`、
`terse_factorial`、`context_long_tail`。

Quick，11 个：`quick_time`、`quick_calc`、`quick_multi_time`、`quick_factorial`、
`quick_files`、`quick_code_file`、`quick_primes`、`quick_fibonacci`、
`quick_summarize`、`quick_pipeline`、`quick_plan`。

`GET /api/arena/templates` 列出它们。`POST /api/arena/judge` 按某 template 的 spec
重新评判答案。`scripts/run-matrix.mjs` 默认运行全部 scored 模板。

## `evaluation/judging.ts` 中的 Judging 语义

- 空答案直接失败，`none` judge 除外。
- `numeric` 提取第一个数字并去除逗号，应用 `operator` 与 `tolerance`。`json` 要求
  一个含 `required_fields` 的顶层对象。`code` 对第一个围栏代码块强制
  `must_contain` 与 `max_len`。`keyword` 使用 `any_of` 与 `all_of` 并去重
  `min_hits`。`exclude` 命中任何模式即失败。`regex` 模式上限 500 字符，只测试答案
  前 2000 字符，作为 ReDoS 防护。

## contracts `AblationRow` 的 ablation 行

`label`、`tool_calls`、`mcp_calls`、`mcp_share`、`skill_reads`、`delegations`、
`reflects`、`observation_chars`、`answer_chars`、`judge_passed`、`success`。它们由
`evaluation/ablation.ts` 从 event 流确定性计数。`judge_passed` 为 `boolean` 或
`null`，在未提供 judge 输入时为 null，给出行为画像而非分数。
