# 运维 runbook

> 语言：**简体中文** | [English](runbook.md)

本地技术栈的日常运维，基于 `apps/server/src/server.ts`、`portcheck.ts`、
`lifecycle.ts` 中的启动与关闭代码，以及 `apps/web/scripts/dev.mjs`。

## 端口与进程

| 关注点 | 值 | 备注 |
|---|---|---|
| Backend | `BACKEND_HOST:BACKEND_PORT`，默认 `127.0.0.1:8281` | 若端口被占用或越界，启动抛出 `InvalidPortError` 或 `PortInUseError`，由宿主入口记录日志后 `exit(1)`。无回退端口。 |
| Frontend dev | `http://localhost:8280` | `apps/web/scripts/dev.mjs` 以 bind 与 connect 双重探测端口，接受 `-p` 或 `--port`。 |
| Frontend start | `next start -p 8280` | 生产模式 |
| 健康 | `GET /api/health` 与 `GET /health` | 始终免鉴权 |
| 关闭 | SIGINT 或 SIGTERM，优雅关闭 5 秒超时，随后强制 `exit(1)` | 先关闭空闲连接 |

## 运行模式

```bash
pnpm -r build      # build every package including both apps
pnpm dev:server   # predev builds, then node --watch dist/main.js; rebuild the server to reload
pnpm start:server # prestart builds, then node dist/main.js; run the built backend
pnpm dev:web       # next dev through the launcher
```

`dev:server` 监视编译产物。编辑后运行 `pnpm -r build`，或只构建触及的 package，
watcher 会重启。链中没有 tsx 或 ts-node。

## Matrix 评估 run

```bash
# terminal 1: configured provider and running server
pnpm dev:server
# terminal 2:
node scripts/run-matrix.mjs [--base http://localhost:8281] [--out matrix.md]
                            [--templates id1,id2] [--timeout-ms 600000]
```

脚本读取 `GET /api/arena/templates` 的 scored 模板，除非收窄，然后流式
`POST /api/arena/matrix`，并打印 markdown 记分板，含每 template 分数、tokens、
tools 与每列 verdict。cell 会消耗真实模型调用。

## 存储

完整布局表见 [../reference/configuration.zh.md](../reference/configuration.zh.md)。
运维备注：

- 所有状态在构造上即 crash-safe：原子写入，使用 `.tmp` 文件与 rename，配 per-path
  队列，外加 `.bak` 恢复。损坏的 provider 文件回退到 `.env` 播种。损坏的 session
  记录被遏制，而非致命。
- 被杀死进程遗留为 `active` 的 session 在下次加载时翻转为 `failed`。
- 超大账本条目位于 `data/sessions.json.blobs/`。删除一个 session 会清除其 blob。
- `data/runs/<runId>/<workspace>/` 下的 workspace 在重启后重水化，以 `MAX_WORKSPACES`
  为上限（默认 32），空闲寿命为 `WORKSPACE_TTL_SECONDS`（默认 3600），LRU 淘汰。
  run 中的 workspace 受保护。
- 要重置，停止技术栈并删除 `data/`。所有状态都可再生，你会丢失 sessions、projects
  与 provider config。

## 故障模式

| 情况 | 行为 |
|---|---|
| Backend 端口被占用或越界 | 宿主入口记录类型化错误并 exit 1，无回退 |
| 非 loopback 绑定且 `API_TOKEN` 为空 | 启动拒绝；loopback 且空 token 只告警 |
| 格式错误的 `MCP_SERVERS` | 告警一次，消息为 `[assemble] MCP_SERVERS ignored`，启动无 MCP 继续 |
| 损坏的 `data/mcp_servers.json` | 以 `[mcp-store] store file unreadable` 告警，启动回退到 `MCP_SERVERS` env 播种，文件保持原样供检查 |
| 注册了零个 driver | 启动快速失败 |
| 能力 dimension 零选项 | 对 `prompt`、`reasoning`、`context`、`harness`、`toolset` 启动快速失败 |
| 未配置 `web_search` | tool 失败关闭并给出设置指引 |
| 账本写入病态，如磁盘满或达上限 | 告警，被观察的 run 继续 |
| 经 Next proxy 的 SSE | 需要 `compress: false`，已在 `next.config.ts` 设置；否则流会缓冲到完成 |

## 调试辅助

- LLM wire trace：builder turn 记录 `llm_request`、`llm_response`、`llm_error` trace
  条目，在 builder trace 面板可见。
- Session 取证：`GET /api/sessions/:id/export` 下载完整记录与条目信封。
- Spill 取证：超大的 tool 输出原样落在 workspace 的 `.spills/` 目录下，模型可见预览
  中带编号 locator。
- `scripts/run-matrix.mjs --out matrix.md` 产生一个可对比产物，用于跨 provider 与
  driver 变更的回归审查。
