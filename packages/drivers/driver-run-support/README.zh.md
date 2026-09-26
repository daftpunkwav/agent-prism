# `@agentprism/driver-run-support`

> 语言：**简体中文** | [English](README.md)

Driver seam：`FrameworkDriverRegistry`，实现 `contracts.DriverLookup`；未知 framework
抛 `DriverNotFoundError`，保留项抛 `DriverReservedError`；可注入 loader 的注册 helper
`registerDriversBestEffort`；以及所有 backend 共享的 run 支持，含
`event-translation`、`tool-batch`、`reasoning-constants`、`recursion-limit`、`tool-schema`；再加上 NDJSON 框架桥传输层
（`bridge-protocol`、`child-bridge`）与运行时探测（`python-probe`）。

`tool-schema` 是各 backend 绑定注册表工具时共用的唯一 JSON-Schema → zod 派生
（LangChain StructuredTool、MCP 工具服务）。

## 依赖

- Runtime：`contracts / harness / telemetry / zod`。无 backend 依赖，不使用 LangChain。
- banner 一致性契约测试位于仓库根（`tests/drivers/`），经各 backend 的公共 barrel 导入。
