# `@agentprism/driver-langgraph`

> 语言：**简体中文** | [English](README.md)

LangGraph driver，`LangGraphDriver`，`frameworkId "langgraph"`：基于 LangChain bridge
leaf 构建的 reasoning-mode 图，含 `react`、`cot-tool`、`reflexion`、`tot`。

- 每个 reasoning 模式编译一张图；`self_consistency` 用全新状态跑 N 次 react 图后投票。
- 自定义 tool 节点让每次调用都走 `tools.execute`，且驱动在工具执行前发出 action 行，
  因此交互式工具（`ask_user`）等待期间即可在列上看到。
- 每个结构性节点开始时以 `[Phase: <节点>]` reflect 事件叙述（骨架循环节点
  `agent / execute / tools` 保持静默），这正是轨迹里能看见该模式图结构的原因。
- provider 的 token 分块填充 thought 通道；当某次模型调用没有任何分块时，其完整输出
  会作为收尾 thought 块发出（`modelOutputText`），因此该列的答案不依赖分块级事件。

## 依赖

- Runtime：`contracts / driver-langchain / driver-run-support / harness`，加上
  `@langchain/core`、`@langchain/langgraph`。
