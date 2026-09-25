# `@agentprism/driver-autogen`

> 语言：**简体中文** | [English](README.md)

AutoGen 模式 framework driver：带 LLM speaker 选择的可对话 group chat。

- `AutogenDriver`，`frameworkId "autogen"`。
- coder 与 reviewer 两种角色按轮次运行；user proxy 执行 tool 调用。
- 选择与 critique 经 `reflect` event 承载，因此 coder 的 thought 携带答案。
- `max_steps` 为每次 group-chat LLM 调用设预算，选择与 speaker 轮次同样计入。
- `reviewerBudgetFor` 在 reflexion 下额外给一轮 reviewer。
- 这是 AutoGen group-chat 模型在 arena 共享 port 上的同构实现，不是厂商代码。

## 依赖

- Runtime：`contracts / driver-run-support / harness / telemetry`。
