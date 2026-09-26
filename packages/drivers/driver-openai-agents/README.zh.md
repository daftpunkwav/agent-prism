# `@agentprism/driver-openai-agents`

> 语言：**简体中文** | [English](README.md)

OpenAI Agents SDK driver：SDK 自带的 run loop（护栏、交接、会话与工具派发）跑在
Arena 的模型与工具端口之上。

- `frameworkId: openai_agents`，banner `[OpenAI Agents SDK]`。
- `ArenaModel` 基于框架中立的 `LlmAdapter` 实现 SDK 公开的 `Model` 接口，因此
  Provider 配置、wire 抓包与 token 台账与其他列完全一致。
- 注册表工具绑定为 function tool；每次调用都经 `tools.execute`，并使用与
  LangChain 列相同的漂移护栏与结果提醒。
- 温度/max tokens/thinking 来自列上配置好的模型，不再二次应用 SDK 侧 `modelSettings`。
