# `@agentprism/route-builder`

> 语言：**简体中文** | [English](README.md)

Builder 领域路由：`registerBuilderRoutes(app, deps)` 挂载 catalog、session CRUD、
热更新与 SSE 流式 chat endpoint。

## 依赖

- Runtime：`contracts / http-runtime`，service 经 `HttpApplicationDeps` 注入，加上
  `hono` 用于 SSE 流式输出。
