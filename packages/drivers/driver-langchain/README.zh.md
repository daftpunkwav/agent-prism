# `@agentprism/driver-langchain`

> 语言：**简体中文** | [English](README.md)

LangChain driver，`LangChainDriver`，`frameworkId "langchain"`，外加 LC 与 message
bridge，含 `llm-message-bridge`、`bind-registry-tools`、`bind-tools-safe`、
`require-chat-model`、`stream-to-message`，与 LangGraph backend 共用。这是仓库中唯一
允许翻译 LC message 的地方；`harness` 保持框架中立。

## 依赖

- Runtime：`contracts / driver-registry / harness`，加上 `@langchain/core`、
  `langchain`、`zod`。
