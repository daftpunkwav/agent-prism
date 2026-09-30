# `@agentprism/harness`

> 语言：**简体中文** | [English](README.md)

中性执行语义：context pipeline、prompt 装配、reasoning 模式、记忆检索、verification
循环与 tool 准入。**不绑定任何 model SDK**，零 `@langchain/*`，由门禁强制：与 drivers
的全部交互都经 `contracts` 的 `LlmMessage / LlmAdapter / AgentDriver` 语言。

## 子域，`src/` 下的内聚目录

| 目录 | 职责 |
|---|---|
| `context/` | 消息规范化、截断与 pipeline：`applyContextPipeline`、`MapContextPolicyRegistry` |
| `prompt/` | Prompt 装配：`prompt-builder`、`assembly`、`MapPromptSectionRegistry`、内置 sections |
| `reasoning/` | Reasoning 模式：`reasoning-modes` |
| `verification/` | judging、reflection、evolution、验证 loop、答案提取（`judge`、`reflect`、`evolve`、`loop`） |
| `memory/` | 检索增强：`rag` |
| `control/` | Tool 准入：`tool-guard`，即 `ToolAccess` |
| `execution-context.ts` / `usage.ts` | 执行 context 与用量记账 |

## Seam

- `AgentExecutionContext` 与 `applyContextPipeline`：driver plugin 消费的 context seam。
- `MapPromptSectionRegistry` 与 `MapContextPolicyRegistry`：prompt section 与 context
  policy 的 registry。
- driver 经 `drivers.FrameworkDriverRegistry` 反向注册实现；`harness` 绝不 import
  `drivers`。

## 依赖

- Runtime：八个 `context-*` 叶子（`context-analytics`、`context-budget`、
  `context-chunking`、`context-compaction`、`context-instructions`、`context-mentions`、
  `context-retrieval`、`context-time`），加上 `contracts / environment / runtime /
  telemetry`。
- 禁止：`drivers / tools / providers / @langchain/*` 以及任何上层 composer。
