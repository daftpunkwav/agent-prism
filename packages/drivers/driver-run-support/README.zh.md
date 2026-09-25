# `@agentprism/driver-run-support`

> 语言：**简体中文** | [English](README.md)

Driver seam：`FrameworkDriverRegistry`，实现 `contracts.DriverLookup`；未知 framework
抛 `DriverNotFoundError`，保留项抛 `DriverReservedError`；可注入 loader 的注册 helper
`registerDriversBestEffort`；以及所有 backend 共享的 run 支持，含
`event-translation`、`capability-banner`、`reasoning-constants`、`recursion-limit`。

## 依赖

- Runtime：`contracts / harness / telemetry`。无 backend 依赖，不使用 LangChain。
- 仅 dev：三个 backend leaf，用于 banner 一致性契约测试。
