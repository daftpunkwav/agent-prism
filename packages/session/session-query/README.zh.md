# `@agentprism/session-query`

> 语言：**简体中文** | [English](README.md)

基于 `SessionStore` port 的无依赖查询引擎。

- `query`：文本搜索、kind 与 status 集合、时间范围、排序、分页。
- `aggregate`：按 kind 与 status 计数、entry 直方图、活动窗口。
- `exportDoc`：用于备份与取证的带版本导出信封组装。
- 依赖 `contracts` 的 session 词汇；存储保持在 port 之后。
