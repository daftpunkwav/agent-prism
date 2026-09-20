# 快速开始

> 语言：**简体中文** | [English](getting-started.md)

## 前置条件

- Node.js >= 20.9，见 `package.json` 的 `engines`。
- pnpm，workspace 管理。`pnpm-workspace.yaml` 的 globs 为 `apps/*` 与
  `packages/*/*`。
- 任何真实 run 之前需配置一个 LLM provider。后端没有 provider 也能启动，run 会在
  模型构造时失败。

## 安装与构建

```bash
pnpm install
pnpm -r build
```

`@agentprism/server` 的 dev 脚本先运行 `predev` 的 `tsc`，再运行
`node --watch dist/main.js`，因此它监视的是编译产物。后端代码改动后重新构建，
watcher 会重启。

## 配置 provider

任选其一：

1. Settings UI。启动两个 server，打开 `http://localhost:8280/settings` 并保存
   endpoints。配置存储在 `data/provider_config.json`。API key 可以是全值引用，
   如 `"${env:MY_KEY}"`，在使用时解析，绝不写回已解析值。
2. `.env` 播种。在仓库根 `.env` 设置 `LLM_*` 变量。它们仅在 `provider_config.json`
   缺失或损坏时为 provider store 播种。

每个变量见 [../reference/configuration.zh.md](../reference/configuration.zh.md)。

## 运行

```bash
pnpm dev:server     # Hono HTTP backend  → http://127.0.0.1:8281
pnpm dev:web         # Next.js frontend   → http://localhost:8280
```

健康探针：`curl http://127.0.0.1:8281/api/health` 返回
`{"status":"ok","service":"arena"}`。

端口来自 settings。`BACKEND_PORT` 默认 8281，`FRONTEND_PORT` 默认 8280。Web dev
启动器会探测其端口，并接受 `-p` 覆盖，如 `node scripts/dev.mjs -p 3000`。
`CORS_ORIGINS` 可增加允许的 origin，通配符 `*` 在 settings 加载时被拒绝。

## 第一次对比

1. 打开 `http://localhost:8280/arena`，输入一个问题，选择一个 dimension 与至少
   两个每列选择，然后运行。
2. 流是 SSE，位于 `POST /api/arena/run`，事件名 `"arena"`。列经
   `@agentprism/arena-view` 实时折叠。
3. 用确定性 judge spec 评判答案，或把该 run 保存为 project。
4. 要跑 scored 批量 run，使用 `node scripts/run-matrix.mjs`。它需要运行中的 runtime
   与已配置的 provider，每个 cell 都消耗真实模型调用。

## 验证

```bash
pnpm test            # full vitest suite
pnpm typecheck       # package typecheck and test typecheck
pnpm boundaries      # dependency direction gate
pnpm check:deps      # declaration honesty and value-edge cycles
```

## 数据位置

一切都持久化在 `data/` 下：`provider_config.json`、`sessions.json` 与
`data/sessions.json.blobs/`、`builder_sessions.json`、`projects.json`，以及
`data/runs/<runId>/<workspace>/` 临时 workspace。布局表见
[../reference/configuration.zh.md](../reference/configuration.zh.md)。

## 常见的首次运行问题

| 症状 | 原因与修复 |
|---|---|
| `dev:server` 以 `PortInUseError` 或 "port already in use" 退出 | Server 抛错而非选择回退端口。释放该端口或修改 `BACKEND_PORT`。 |
| API 返回 401 | 设置了 `API_TOKEN`。发送 `Authorization: Bearer <token>` 或 `X-API-Token: <token>`。 |
| Run 以配置错误失败 | 没有可用的 provider endpoint。检查 settings 页面，或确认 `${env:…}` 变量存在。 |
| Web 启动端口与预期不同 | dev 启动器探测 8280，可用 `-p` 指向别处。`FRONTEND_PORT` 只喂给 CORS allowlist。 |
