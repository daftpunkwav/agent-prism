# server/

`@agentprism/server` 是组合根与 HTTP 宿主：一个轻量 Hono 服务，把所有
`@agentprism/*` 能力组装到一起并在单一端口上对外提供 API。它自身不含业务逻辑
——业务全部在下方的工作区包里。

角色定位与依赖约束见 [apps/README.md](../README.md)；启动顺序细节见
[docs/architecture/composition-root.zh.md](../../docs/architecture/composition-root.zh.md)。

## 命令

| 命令 | 行为 |
|---|---|
| `pnpm dev:server` | 先 `tsc` 构建，再以 `node --watch dist/main.js` 运行（改动重启循环） |
| `pnpm start:server` | 先 `tsc` 构建，再运行 `node dist/main.js` |
| `pnpm --filter @agentprism/server build` | 将 `src/` 编译到 `dist/` |
| `pnpm --filter @agentprism/server typecheck` | 仅类型检查，不产出 |

`predev` / `prestart` 钩子会自动执行 `tsc` 构建，因此服务器启动时 `dist/` 总是
新鲜的。本包还提供 `bin`（`agent-prism-server` → `dist/main.js`）供安装后使用。

## 配置

环境键由 `@agentprism/config` 从仓库根 `.env` 读取（单一配置源；见
`packages/config`）：

| 键 | 默认值 | 含义 |
|---|---|---|
| `BACKEND_HOST` | `127.0.0.1` | 监听地址 |
| `BACKEND_PORT` | `8281` | 监听端口；`src/portcheck.ts` 会先校验端口可用性 |
| `API_TOKEN` | 空 | 设置后 API 请求必须携带 |

## 源码导览

| 文件 | 职责 |
|---|---|
| `src/main.ts` | 启动顺序：`assemble()` → `startServer()` → `installSignalHandlers()` |
| `src/assemble.ts` | 唯一的组合根：构造 driver 注册表、执行 `registerDriversBestEffort`、挂载路由叶包 |
| `src/load-drivers.ts` | `builtinDriverLoaders`，各 driver 后端的动态导入 |
| `src/mount-routes.ts` | 按顺序挂载路由叶包；`GET /api/sessions/stats` 必须先于 `GET /api/sessions/:sessionId` 注册 |
| `src/server.ts` | Hono 应用监听服务 |
| `src/portcheck.ts` | 端口可用性校验 |
| `src/lifecycle.ts` | 信号处理与优雅停机 |

## 测试

`tests/` 存放宿主级套件：真实 `assemble()` 组装并在真实端口上探测
（`assemble.test.ts`），以及路由挂载、driver 加载、信号生命周期、启动失败路径。
归属规则见 [tests/README.md](../../tests/README.md)；套件随根 `pnpm test`
运行（根 vitest 配置的 include 覆盖 `apps/*/tests`）。
