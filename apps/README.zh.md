# apps/

> 语言：**简体中文** | [English](README.md)

workspace glob `apps/*` 包含两个可运行的 application。它们位于依赖图顶部：消费
`@agentprism/*` package，而不被它们消费。它们是 application 而非能力 leaf，因此
[packages/README.md](../packages/README.md) 中的 leaf README 契约不适用于它们。

| App | Package | 职责 | 入口 |
|---|---|---|---|
| [`server/`](server/) | `@agentprism/server` | 组合根与 HTTP host：settings、driver 注册、route 挂载、service 装配、端口监听 | `src/main.ts` |
| [`web/`](web/) | `@agentprism/web` | Next.js 前端，含 arena、builder、sessions、threads 与 settings 页面 | `src/app` |

## server/

- `src/main.ts` 依次运行 `assemble()`、`startServer()`、`installSignalHandlers()`。
- `src/assemble.ts` 是唯一的组合根。它是唯一允许构造 driver registry、调用
  `registerDriversBestEffort`、挂载 `register*Routes` leaf 的地方。
- `src/load-drivers.ts` 定义 `builtinDriverLoaders`，即各 driver backend 的动态
  import。
- `src/mount-routes.ts` 按顺序挂载 route leaf。`GET /api/sessions/stats` 注册在
  `GET /api/sessions/:sessionId` 之前。
- `src/server.ts`、`src/portcheck.ts`、`src/lifecycle.ts` 覆盖 serve、端口校验与信号
  处理。

启动顺序与守卫详见
[docs/architecture/composition-root.zh.md](../docs/architecture/composition-root.zh.md)。

## web/

- `src/app` 存放 Next.js App Router 页面。
- `src/components` 存放展示组件。
- `src/i18n` 存放 catalog 与应用内 guide 内容。UI 文案放在
  `src/i18n/catalogs/{en,zh-CN}`，由 `pnpm --filter @agentprism/web check:i18n` 检查。

## 依赖约束

- `apps/server` 可以依赖任何 `@agentprism/*` package，因为它是组合根。
- `apps/web` 只能依赖 `client`、`ui`、`arena-view`，由
  `scripts/check-boundaries.mjs` 强制。

构建与运行命令见根 [README.zh.md](../README.zh.md) 与
[docs/operations/runbook.zh.md](../docs/operations/runbook.zh.md)。
