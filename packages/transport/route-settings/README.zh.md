# `@agentprism/route-settings`

> 语言：**简体中文** | [English](README.md)

Settings knob 与 memory 状态的领域路由。

- `registerSettingsRoutes(app, deps)` 挂载 `GET` 与 `PUT /api/settings/knobs`、
  `GET /api/settings/memory`、`POST /api/settings/memory/clear`。
- controller 经 `HttpApplicationDeps` 传入；缺少 controller 时跳过注册，使没有这些
  seam 的宿主仍能启动。

## 依赖

- Runtime：`http-runtime`。
