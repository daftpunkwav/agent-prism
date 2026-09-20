# `@agentprism/route-threads`

> 语言：**简体中文** | [English](README.md)

Agent-thread 路由。`registerThreadRoutes` 基于持久 `ThreadService` 挂载创建、列表、
详情、fork、resume-run 与删除 endpoint。transcript 与 workspace 跨重启存活，fork
分支 workspace，resume-run 流使用 SSE 事件名 `thread`。

## 依赖

- Runtime：`application / contracts / http-runtime`。
