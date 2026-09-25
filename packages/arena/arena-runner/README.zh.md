# `@agentprism/arena-runner`

> 语言：**简体中文** | [English](README.md)

并行多列执行：`ArenaRunner`，负责 breaker、semaphore 与 event-channel 编排；
column-factory port 以 `ColumnRuntimeFactory` 存在于 contracts。

## 依赖

- Runtime：`contracts / runtime / agent`，加上 `arena-dimensions` 的类型。
