# `@agentprism/route-arena`

> 语言：**简体中文** | [English](README.md)

Arena 领域路由：`registerArenaRoutes(app, deps)` 挂载 run 启动、column 查询、流式
event 与 judging endpoint。

## 依赖

- Runtime：`contracts / http-runtime`，service 经 `HttpApplicationDeps` 注入，加上
  `hono` 用于 SSE 流式输出。
