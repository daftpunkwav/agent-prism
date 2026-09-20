# Event 契约

> 语言：**简体中文** | [English](events.md)

流式词汇定义于 `packages/contracts/contracts/src/events.ts`，arena 用；
以及 `packages/contracts/contracts/src/builder.ts`，builder 用。线上的一切都会针对
这些 schema 做 zod 校验。

## Arena events

`ArenaEvent` 按 `type` 判别，有 16 个变体。

| `type` | 含义 |
|---|---|
| `thought` | 推理文本 |
| `thought_delta` 与 `thought_end` | 流式 thinking |
| `thinking` | thinking 内容 |
| `step_start` | driver 开始一次 LLM 调用时、在首个 token 之前发出 |
| `action` | tool 调用 |
| `observation` | tool 结果，在 `OBSERVATION_MAX_CHARS = 8000` 处截断 |
| `tool_progress` | 流式 tool 进度 |
| `file_diff` | write 或 edit tool 成功后发出，所有 driver 均如此 |
| `verify` | verification 循环输出 |
| `reflect` | 反思或思考输出；planner 与 critic 也经此承载 |
| `harness_edit` | harness 自编辑 |
| `report` | SSE 尾部的对比报告 |
| `complete` | 终止 metrics，其中 `token_stats` 默认从 `metrics` 派生 |
| `error` | 系统级，`pipeline: "system"`，或列级 |
| `token_update` | 始终携带完整 `TokenStats` |

`ArenaEventBase` 中的基础字段：`pipeline`，即显示 label 与聚合键；`workspace`、
`content`、`tool`、`args`、`result`、`step`、`passed`、`reason`、`metrics`、
`message`、`token_stats`、`turn`、`runId`、`timestamp`，以毫秒计并来自 runner 的
Clock；以及可选 `agentId`。

- `turn` 从 1 开始，`0` 表示未标注。运行时侧的 `stampEvent` 回填缺失字段，手写
  driver event 也包含在内。
- `TokenStats`：`input_tokens`、`output_tokens`、`total_tokens`、`context_window`、
  `max_input_tokens`、`max_output_tokens`、`context_usage_pct`、`input_usage_pct`。
  默认 context window 128 000，max input 120 000，max output 2048。
- `PipelineMetrics` 额外含 `success`、`duration_ms`、`tool_calls`、`steps`。
- 嵌套的 subagent 与 ralph_loop event 在内部消费，绝不上传重放。其 token 经
  `complete` event metrics 折叠进父级。
- 用于 judging 的答案提取读取最后一条 `thought`，否则最后一条 `observation`，
  这就是思考必须经 `reflect` 承载的原因。
- `contracts/src/arena.ts` 中的共享上限：`MAX_HISTORY_CHARS = 24 000`、
  `ARENA_MIN_SELECT = 1`、`OBSERVATION_MAX_CHARS = 8 000`。

## SSE 传输形态

- `POST /api/arena/run` 以事件名 `"arena"` 流式输出，每帧携带一个 `ArenaEvent`。
  以终止性 `report` event 结束，然后关闭。
- `POST /api/arena/matrix` 流式输出 `"matrix"`：`matrix_progress` 帧为
  `{template_id, status, score?, error?}`，status 为 `started`、`scored` 或
  `failed`；并有一个最终 `matrix_report`，其 `cells[]` 携带每 template 的
  `score {passed, total}`、每列 verdict，以及可选 metrics 与 ablation。
- Abort 端到端生效，session 记为 `cancelled`。
- 流内的错误是同通道上的 `error` event，流绝不静默死亡。

## Builder stream chunk

Builder chunk 按 `stream` 判别。

| `stream` | 载荷 |
|---|---|
| `trace` | `BuilderTraceEntry`，`kind` 为 `llm_request`、`llm_response`、`llm_error`、`session`、`swap` 或 `notice`，外加 `id`、`seq`、`ts`、`turn`、`title`、`data`、`durationMs` |
| `event` | 该 turn 的完整 arena `ArenaEvent` |
| `turn` | `BuilderTurnMeta`，含 `turn`、`runId`、`answer`、`metrics`、`workspace` |
| `error` | `{message, fatal}` |

流总以 `[DONE]` data frame 终止，除非客户端断开。
`BUILDER_MESSAGE_MAX_CHARS = 12 000`。

## 前端折叠

`@agentprism/arena-view` 把原始流转换为视图状态：每列状态、折叠后的 trace、
final-answer extraction、report 渲染。它是纯的，仅依赖 `contracts`，由 arena 页面与
builder trace 渲染共享。
