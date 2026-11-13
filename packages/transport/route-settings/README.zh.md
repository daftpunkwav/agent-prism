# `@agentprism/route-settings`

> 语言：**简体中文** | [English](README.md)

Settings 领域路由：runtime knobs（`GET`/`PUT /api/settings/knobs`）、memory 状态
（`GET /api/settings/memory`、`POST /api/settings/memory/clear`）、用户 skills
（`/api/settings/skills` CRUD 与 enable toggle），以及受管 MCP server 列表
（`GET`/`PUT /api/settings/mcp`）。

- `registerSettingsRoutes(app, deps)` 为每个注入了 controller 的路由族挂载；缺少
  controller 时跳过注册，使没有这些 seam 的宿主仍能启动。
- 错误码契约：这些手写校验端点对非法输入返回 400 与 `{detail}`（其他经 schema 校验的
  路由返回 422）；skill 身份冲突（bundled read-only、重名）返回 409，持久化失败会传播
  到 shell 的 5xx 映射。

## 依赖

- Runtime：`http-runtime`。
