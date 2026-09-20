# Package 布局与约定

> 语言：**简体中文** | [English](package-layout.md)

本仓库是一个 pnpm workspace，`pnpm-workspace.yaml` 中恰好只有两个 glob 根：
`apps/*` 与 `packages/*/*`。每种能力都位于两级路径 `packages/<family>/<leaf>/`。
没有扁平的 package。

## Family 与 leaf 结构

- family 目录聚合相关 leaf，并携带一张角色表 `README.md`。索引见
  [packages/README.md](../../packages/README.md)。
- leaf 是真实的 workspace package，命名为 `@agentprism/<leaf>`，恰好提供：
  `src/` 与公开 barrel `src/index.ts`、就近放置的 `tests/`、说明职责、seam 面与
  依赖方向的 `README.md`、含 `private: true` 的 `package.json`，以及 extend 根基础
  配置的 `tsconfig.json`。
- 单 leaf family 与 family 名同名，例如 `agent/agent` 与 `contracts/contracts`，
  遵循 [architecture.zh.md](../architecture.zh.md) 中的统一布局约定。

当前 families 共 61 个 leaf：`agent`、`application`、`arena-view`、`arena`、
`builder`、`client`、`config`、`context` 含 8 个 `context-*` leaf、`contracts`、
`dimensions`、`drivers` 含 8 个、`environment`、`evaluation`、`harness`、`memory` 含
4 个、`persistence`、`providers` 含 2 个、`runtime`、`sandbox`、`session` 含 8 个、
`telemetry`、`tools` 含 4 个、`transport` 含 8 个，以及 `ui`。

## 依赖铁律

由 `pnpm boundaries` 从 `scripts/check-boundaries.mjs` 强制。声明真实性由
`pnpm check:deps` 单独强制。见
[../operations/quality-gates.zh.md](../operations/quality-gates.zh.md)。

1. `contracts` 导入零个 `@agentprism/*`。`environment` 与 `persistence` 同样是
   无依赖 leaf。
2. 八个 `context-*` leaf 无依赖。
3. Plugin leaf 消费 seam，绝不消费 composer 或 providers：
   - `tool-registry` 仅依赖 `contracts`。`tool-builtins` 仅依赖 `contracts`、
     `environment`、`tool-registry` 与 `tool-symbols`。`tool-mcp` 仅依赖
     `contracts` 与 `tool-registry`。
   - `driver-registry` 仅依赖 `contracts`、`environment`、`runtime`、`telemetry`
     与 `harness`。backend 额外引入 `driver-registry`，`driver-langgraph` 还
     引入 `driver-langchain`。
   - `provider-capability` 仅依赖 `contracts`、`config`、`persistence`、
     `environment`、`runtime` 与 `telemetry`。`provider-langchain` 额外引入
     `provider-capability`。
4. `arena` 绝不接触 `@langchain/*` 或 providers。`application` 绝不接触
   provider 或 evaluation 实现。
5. `http-runtime` 与 `route-*` 仅依赖 `application`、`builder`、`config` 与
   `contracts`，routes 还依赖 `http-runtime`。shell 绝不反向依赖 routes。
6. `apps/web` 只能依赖 `client`、`ui` 与 `arena-view`。

完整的逐 package 规则列表是 `scripts/check-boundaries.mjs` 中的 `RULES` 数组，
它是唯一事实来源。

## 名称解析

| 机制 | 文件 | 如何保持正确 |
|---|---|---|
| Runtime，vitest | 根 `vitest.config.ts` | 生成：`workspaceAliases()` 在配置加载时扫描每个 leaf 的 `package.json` 并把 `name` 映射到 `src/`，新 leaf 无需编辑 |
| Typecheck，tests | 根 `tsconfig.tests.json` | 手工维护：每个 package 一条显式 `paths`，因为 TS5096 最多允许一个 `*`，新 leaf 必须加一行 |
| 编辑器 | 根 `tsconfig.json` | 继承 `tsconfig.tests.json`，使编辑器能解析 `tests/` 下文件对 workspace 包的 import；没有任何仓库脚本以 `-p` 使用它 |

## 东西该放哪

| 你要新增… | 放到… | 指南 |
|---|---|---|
| 一个 tool | `packages/tools/tool-builtins/src/definitions/<name>.ts` | [../guides/add-a-tool.zh.md](../guides/add-a-tool.zh.md) |
| 一个 framework driver | `packages/drivers/driver-<name>/` | [../guides/add-a-driver.zh.md](../guides/add-a-driver.zh.md) |
| 一个对比 dimension | `packages/dimensions/dimensions/src/dimensions/<name>.ts` | [../guides/add-a-dimension.zh.md](../guides/add-a-dimension.zh.md) |
| 一个 package | `packages/<family>/<leaf>/` | [../guides/add-a-package.zh.md](../guides/add-a-package.zh.md) |
| 一个跨域测试 | `tests/<journey>/`，仅公开导出 | [../operations/testing.zh.md](../operations/testing.zh.md) |
| 一条 HTTP 路由 | `packages/transport/route-<domain>/` | [../reference/http-api.zh.md](../reference/http-api.zh.md) |

## 跨 package 的约定

- 测试要么是 leaf 本地的 `packages/<family>/<leaf>/tests/`，要么是跨域 journey 的
  `tests/<journey>/`。package 测试绝不伸进另一 package 的内部，journey 只经
  公开 barrel。
- 每个 leaf README 都说明职责、seam 面与依赖方向。
- 代码、注释与文档为英文。用户可见的 UI 文案放在
  `apps/web/src/i18n/catalogs/` 下的 i18n catalog。
- 决策登记表见 [decision-register.zh.md](decision-register.zh.md)。
