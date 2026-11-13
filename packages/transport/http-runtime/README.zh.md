# `@agentprism/http-runtime`

> 语言：**简体中文** | [English](README.md)

HTTP 外壳：`createHttpApplication(deps)`，含 DNS rebinding Host 守卫、CORS allowlist、
跨站状态变更守卫、流式强制的 body 大小上限、API-token auth、health check、error
mapping；共享路由 pipeline，含 `HttpApp` 类型、`assertBodySize`、`readJsonRaw` 与
`parseJsonBody`；以及 `HttpApplicationDeps` 依赖 port。它不挂载任何领域路由，由组合根
完成装配。

## 依赖

- Runtime：`application / builder-service / config / contracts`，多为 service 类型，
  加上 `hono`。
