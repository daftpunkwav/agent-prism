# `@agentprism/session`

> 语言：**简体中文** | [English](README.md)

`SessionStore` port 位于 `contracts`，与 `ToolRegistry`、`DriverLookup` 同一模式。
本 leaf 提供 `InMemorySessionStore`，校验与文件后端相同，适用于测试与一次性账本；
同时定义 title、entries 与 session count 的上限，文件后端从同一来源引用。

## 依赖

- Runtime：仅 `contracts`。
