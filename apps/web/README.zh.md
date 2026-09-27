# web/

`@agentprism/web` 是 Next.js App Router 前端：arena、builder、sessions、
projects、settings 页面与应用内 guide/learn 文档站。它只通过同源 `/api` 代理
与后端通信，且仅消费三个工作区包。

角色定位与依赖约束见 [apps/README.md](../README.md)。

## 命令

| 命令 | 行为 |
|---|---|
| `pnpm dev:web` | `scripts/dev.mjs`：端口预检后启动 Next dev server（8280） |
| `pnpm --filter @agentprism/web build` | `next build` |
| `pnpm start`（本包内） | `next start -p 8280` |
| `pnpm --filter @agentprism/web lint` | ESLint |
| `pnpm --filter @agentprism/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @agentprism/web check:i18n` | 多语言目录一致性门禁 |

`scripts/dev.mjs` 做了三件裸 `next dev` 不会做的事：先探测端口（bind + connect
双重探测），冲突时给出排查指引并退出；接受 `-p/--port` 换端口；强制
`NODE_ENV=development`，防止 shell 全局的 production 值把 React 切到生产模式
（开发期告警与 hydration 预期都会随之改变）。

## 端口与代理

- dev/生产服务器监听 **8280**；后端监听 **8281**。
- `next.config.ts` 把同源 `/api/:path*` 重写到 `http://127.0.0.1:$BACKEND_PORT`，
  浏览器永远不发跨域请求。
- `BACKEND_PORT` 的解析顺序：进程环境变量 → 仓库根 `.env` → 兜底 `8281`。
  编辑 `.env` 即唯一配置源，代理自动跟随。
- `compress: false` 是刻意的：Next 的 gzip 会缓冲代理的 SSE 流、直到运行结束
  才一次性刷出，arena 轨迹将无法逐步渲染。
- CSP 在 `src/proxy.ts`（Next 16 的 `proxy` 文件约定，旧名 `middleware`）而不在
  `next.config.ts`，因为它携带每请求的 script nonce：生产环境只放行带该 nonce 的
  内联脚本（Next 内联的 flight 数据与 theme/skin/locale 引导脚本），dev 额外放行
  `unsafe-eval` 以支持热更新。`/api` 与静态资源被 matcher 排除、不带 CSP——策略只
  约束文档，且代理必须原样透传。若切换为直连后端模式（`NEXT_PUBLIC_API_BASE`），
  必须把后端地址加入那里的 `connect-src`，否则 REST 与 SSE 请求会被静默拦截。

## 源码导览

| 路径 | 职责 |
|---|---|
| `src/app/` | App Router 页面：`arena`、`builder`、`sessions`、`projects`、`settings`，以及 `guide` 与 `learn` |
| `src/components/` | 跨页面共享的展示组件 |
| `src/i18n/` | 多语言目录（`catalogs/en`、`catalogs/zh-CN`）与 guide/learn 内容；见 [src/i18n/README.md](src/i18n/README.md) |
| `src/proxy.ts` | 携带 script nonce 的每请求 CSP |
| `scripts/` | `dev.mjs` 启动器与 `check-i18n.mjs` 门禁 |

## 依赖

`apps/web` 只允许依赖 `@agentprism/client`、`@agentprism/ui` 与
`@agentprism/arena-view`，由 `scripts/check-boundaries.mjs` 强制；不得直接
import `@agentprism/contracts`。

## 测试

`tests/` 存放 58 个 jsdom + testing-library 套件，覆盖页面、分区组件与 hooks。
套件随根 `pnpm test` 运行（根 vitest 配置的 include 覆盖 `apps/*/tests`，并把
`@/` 别名映射到 `src/`）。
