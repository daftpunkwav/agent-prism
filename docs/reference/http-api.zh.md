# HTTP API

> 语言：**简体中文** | [English](http-api.md)

所有路由由 `packages/transport/` 下的 route leaf 注册，并由
`apps/server/src/mount-routes.ts` 按 provider、settings、sessions、arena、workspace、
projects、builder、threads 的顺序挂载。事实来源为各节引用的 route 文件。

## `packages/transport/http-runtime` 中的横切行为

- CORS。allowlist 由 `http://localhost:<FRONTEND_PORT>`、
  `http://127.0.0.1:<FRONTEND_PORT>` 与 `CORS_ORIGINS` 条目构建。`*` 在 settings
  加载时被拒绝。方法为 `GET`、`POST`、`PUT`、`DELETE`、`OPTIONS`。头为
  `Content-Type`、`Authorization`、`X-API-Token`。
- Auth。若 `API_TOKEN` 为空，所有请求通过。`/api/health` 与 `/health` 豁免。凭证为
  `Authorization: Bearer <token>`，scheme 大小写不敏感；或 `X-API-Token: <token>`。
  失败返回 `401 {"detail": …}`。
- Body 上限。`MAX_REQUEST_SIZE` 默认 10 MiB，在 `Content-Length` 上强制，并在流式
  传输时再次强制，因此分块 body 无法绕过。超限返回 `413`。非 JSON body 返回 `400`，
  schema 违规返回 `422` 并附首个 zod issue 消息。
- 错误形态。`AppError` 与 `BuilderError` 返回 `{"detail"}` 并带各自 status。其他
  一切返回 `500` 并附经净化的消息。
- 健康。`GET /api/health` 与 `GET /health` 返回
  `{"status":"ok","service":"arena"}`。

## `route-provider/src/provider.ts` 中的 Provider settings

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/settings/provider` | 公开的 provider config 视图 | key 被打码，绝不返回原始值 |
| PUT | `/api/settings/provider` | 保存 provider config | zod 校验，否则 422；接受遗留扁平协议；空 key 按 endpoint id 或 fingerprint 继承已存储 key |
| POST | `/api/settings/provider/test` | 连通性测试，不保存 | 空 body 测试已存储的配置 |

## `route-settings/src/settings.ts` 中的 Settings knobs 与 memory

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/settings/knobs` | 读取当前 runtime knobs | 返回 `{knobs, fields}`；宿主未注入 knob store 时跳过注册 |
| PUT | `/api/settings/knobs` | 热应用 knob 更新 | 返回 `{knobs, fields}` |
| GET | `/api/settings/memory` | 跨 session 记忆状态 | episodic 与 semantic 的计数与文件路径 |
| POST | `/api/settings/memory/clear` | 清空两个记忆 store | 返回状态 |

## `route-sessions/src/sessions.ts` 中的 Sessions

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/sessions/stats` | 按 kind 与 status 计数 | 刻意注册在 `/:sessionId` 之前 |
| GET | `/api/sessions/telemetry` | 纯文本 telemetry 报告 | 确定性渲染的报告行，为空的 kind 省略；与 stats 同理注册在 `/:sessionId` 之前 |
| GET | `/api/sessions` | 过滤列表 | `kind` 为 `arena`、`agent`、`builder`；`status` 为 `active`、`completed`、`failed`、`cancelled`；`limit` 至少 0，上限 200；违规返回 400 |
| GET | `/api/sessions/:sessionId` | 记录与条目 | 缺失时 404 |
| GET | `/api/sessions/:sessionId/export` | JSON 下载 | `Content-Disposition: attachment`；`exportedAt` 来自注入的 clock |
| POST | `/api/sessions/export` | 按 ids 批量导出 | body `ids`；返回 `{documents}`；即使是无 `Content-Length` 的分块请求，body 大小上限依然生效 |
| DELETE | `/api/sessions/:sessionId` | 运维删除 | `{deleted: <id>}`；blob sidecar 被清除 |

## `route-arena/src/arena.ts` 中的 Arena

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/arena/meta` | dimensions、选项与 templates 元数据 | `min_select` 为 1；UI 可以停在零选择并禁用 run |
| POST | `/api/arena/run` | 启动一次对比 run | SSE，事件名 `"arena"`。Body：`question` 为 1 至 4000 字符，`dimension` 默认 `framework`，`selections` 至多 16、至少 1，省略表示全部，可选 `column_sessions`，`attachments` 至多 5 个、每个 64 KiB 文本。`onAbort` 取消该 run，abort 记为 `cancelled`。流内失败作为 `error` event 发出，绝不静默关闭 |
| POST | `/api/arena/answer` | 回答一个待处理的 ask_user 问题 | body 为 `agent_id`、`question_id`、`answer`；无活跃列等待时 404 |
| GET | `/api/arena/pending-asks` | 等待人工回答的列 | 返回 `{pending}`，每个活跃列为一个 `{agentId, questions}` 条目，含完整待答 ask_user 问题 |
| POST | `/api/arena/stop-column` | 仅停止一个活跃列 | body `agent_id` 来自列 event；其他列继续运行；被停止的列以 `Column stopped by user` 错误与 failed complete 结算；已结算时 404 |
| GET | `/api/arena/column-logs` | 每列 run 日志，含原始 event 与捕获的 LLM wire | 需要 `?workspace=` 与 `?label=`，否则 400。返回 `{workspace, label, events, wire, truncated}`，尾部截断。在 run 流式期间轮询安全。未知 workspace 或 label 返回空结果，而非 404 |
| GET | `/api/arena/templates` | 任务模板 | `{templates: […]}`，含 15 个 scored 与 11 个 quick |
| POST | `/api/arena/judge` | 评判答案 | `template_id` 与至多 16 条的 `answers` 记录 |
| POST | `/api/arena/judge-async` | 经异步端口评判答案 | body 与 `/api/arena/judge` 相同；`llm` 模板在异步 judge 已接线时走异步路径，否则回退同步 fail-closed 判定并在结果中说明缺接线 |
| POST | `/api/arena/matrix` | 1 至 8 个 template cell | SSE，事件名 `"matrix"`；`matrix_progress` 与最终 `matrix_report`；每 cell 失败隔离；同一 abort 语义 |

## `route-workspace/src/workspace.ts` 中的 Workspace 文件

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/arena/workspace/:workspaceName/files` | 列出 workspace 文件 | |
| GET | `/api/arena/workspace/:workspaceName/file` | 读取一个文件 | 需要 `?path=`，否则 400 |
| PUT | `/api/arena/workspace/:workspaceName/file` | 写入或创建 | `path` 至多 512 字符，`content` 至多 512 Ki 字符，`create_only` 默认 false |
| DELETE | `/api/arena/workspace/:workspaceName/file` | 删除文件 | 需要 `?path=` |

## `route-projects/src/projects.ts` 中的 Projects

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/arena/projects` | 列出已保存 projects | |
| POST | `/api/arena/projects` | 把一个 run 归档为 project | `workspace_names` 由 `pipeline_labels` 取默认；保存失败返回 500 |
| DELETE | `/api/arena/projects/:projectId` | 删除 project | 不存在时 404 |

## `route-builder/src/builder.ts` 中的 Builder

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/builder/catalog` | 用于装配的选项目录 | |
| GET | `/api/builder/sessions` | 列出 builder sessions | |
| POST | `/api/builder/sessions` | 创建 session | `name` 至多 60 字符；空名使 store 生成显示名；部分 `composition` |
| GET | `/api/builder/sessions/:id` | 详情，含 trace log | |
| PATCH | `/api/builder/sessions/:id` | 在 turn 之间热替换 composition | |
| DELETE | `/api/builder/sessions/:id` | 删除 session | |
| POST | `/api/builder/sessions/:id/abort` | 中止进行中的 turn | `{ok, aborted}` |
| POST | `/api/builder/sessions/:id/chat` | 一次 chat turn | SSE，事件名 `"builder"`；`message` 至多 12 000 字符；`attachments` 至多 5；除非客户端断开，否则以 `[DONE]` 终止 |

## `route-threads/src/threads.ts` 中的 Threads

持久 fork 与 resume threads。语义、上限与 run 循环详见
[threads.zh.md](threads.zh.md)。

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/threads` | 列出 thread 视图 | 最旧优先，无 transcript |
| POST | `/api/threads` | 创建 thread | body `{title?, config}`；`config` 是完整 `PipelineConfig`，应用默认值 |
| GET | `/api/threads/:id` | 详情 | `{thread, history}`；缺失时 404 |
| DELETE | `/api/threads/:id` | 删除 thread | turn 运行中时 409 |
| POST | `/api/threads/:id/fork` | fork | transcript 复制与 workspace 分支；设置 `fork_of`；运行中 409 |
| POST | `/api/threads/:id/run` | 运行一个 turn，即 resume | SSE，事件名 `"thread"`；冲突与 404 在流打开前以 HTTP status code 呈现 |

## `packages/client` 中的 Client 映射

Web app 绝不手写调用这些 URL。`packages/client/client/src` 一对一映射它们：
`fetchArenaMeta`、`streamArenaRun`、`streamMatrixRun`、`fetchTemplates`、
`judgeAnswers`，以及 `client.ts` 中的 project 与 workspace helper、
`builder.ts` 中的 builder helper、`sessions.ts` 中的 session helper、
`threads.ts` 中的 thread helper。设置了 `NEXT_PUBLIC_API_BASE` 时，URL 会加该前缀。
REST 调用默认 15 秒超时，SSE 流以 `timeout: false` 打开并支持 abort。
