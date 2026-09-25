# `@agentprism/provider-langchain`

> 语言：**简体中文** | [English](README.md)

SDK adapter leaf：从 config 构建 chat model，含 thinking-budget 映射与统一的
`LLM_TIMEOUT_MS` 超时；把它们适配为 `contracts.LlmAdapter`；探测连通性；追踪 LLM
流量。这是仓库中仅有的两处可直接接触 model SDK 的位置之一，另一处是
`driver-langchain` 的 LC 侧。

## 依赖

- Runtime：`contracts / provider-catalog`，加上 `@langchain/core`、
  `@langchain/openai`、`@langchain/anthropic`。
