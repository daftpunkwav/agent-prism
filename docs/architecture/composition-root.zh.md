# 组合根

> 语言：**简体中文** | [English](composition-root.md)

`apps/server/src/assemble.ts` 是仓库中唯一的组合根。它是唯一允许构造 driver
registry、调用 `registerDriversBestEffort`、挂载 `register*Routes` leaf 的地方。
`bootstrap.ts` 是已弃用的别名，重新导出 `assemble`。

## 入口链与进程行为

- `src/main.ts`：`assemble()`，然后 `startServer()`，然后 `installSignalHandlers()`。
- `src/server.ts`：在 `@hono/node-server` 的 `serve(...)` 之前调用
  `ensurePortAvailable(settings.backendHost, settings.backendPort)`，并注册一个
  `EADDRINUSE` 错误监听器覆盖探测到绑定的竞态。stop 先关闭空闲连接，再关闭
  server。
- `src/portcheck.ts`：当端口超出 1 至 65535 或已被占用时抛出 `InvalidPortError`
  或 `PortInUseError`。它绝不调用 `process.exit`，由宿主入口记录日志并退出。
  没有自动回退端口。
- `src/lifecycle.ts`：SIGINT、SIGTERM、SIGBREAK 有 5 秒优雅关闭超时，随后强制
  `exit(1)`。`disposeSignalHandlers()` 为测试与嵌入宿主解绑监听器。
- dev 脚本先运行 `predev` 的 `tsc`，再运行 `node --watch dist/main.js`。它监视的是
  编译产物。见 [../operations/runbook.zh.md](../operations/runbook.zh.md)。

## `assemble()` 按顺序创建什么

对 `apps/server/src/assemble.ts` 的简略导览：

1. `loadSettings()`。见 [../reference/configuration.zh.md](../reference/configuration.zh.md)。
2. 快速失败鉴权守卫。非 loopback 的 `BACKEND_HOST` 遇到空 `API_TOKEN` 时拒绝启动。
   loopback 且空 token 只告警。
3. 基础 port：`SystemClock` 与 `RandomIdGenerator`。
4. `ProviderConfigStore` 基于 `AtomicJsonFile(data/provider_config.json)` 并带
   `LLM_*` env 播种，加上 `EndpointCatalog`、`ProviderLookupAdapter`、
   `DimensionCatalog`。
5. `WorkspaceRegistry({ runsRoot: data/runs, clock })`。
6. `ProviderDimensionSync` 与 `DimensionRouter`，带一个 provider-store 变更监听器
   调用 `router.invalidateProviderCache()`。
7. Report 与 judge 装配：`buildComparisonReport` 与 `createChatModel`，由
   `createColumnRuntime` 构建的 `ColumnRuntimeFactory`，以及 `judgeAnswers`。
8. Drivers，经 `registerFrameworkDrivers()`，见下。若零 driver 注册，启动快速
   失败。
9. Builder runtime：带 LLM wire-trace handler 的 model factory，从活 provider
   config 投影 endpoint，以及基于 `AtomicJsonFile(data/builder_sessions.json)` 的
   `BuilderSessionStore`。
10. Session 账本：`FileSessionStore` 基于 `AtomicJsonFile(data/sessions.json)`，
    以 `FileBlobStore(data/sessions.json.blobs)` 作为超大条目 sidecar，然后是
    `SessionService` 与 `BuilderService`。
11. 能力 seam 检查：`prompt`、`reasoning`、`context`、`harness`、`toolset` 各自必须
    暴露至少一个选项，否则启动抛错。
12. `MCP_SERVERS` 解析，经 `parseMcpServersEnv`。格式错误的配置告警一次，消息为
    `[assemble] MCP_SERVERS ignored`，启动以空列表继续。
13. Services：`ArenaService`、`MatrixService`、`ProviderService`、
    `WorkspaceFileService`，以及基于 `AtomicJsonFile(data/projects.json)` 的
    `ProjectStore`。
14. `mountDomainRoutes(deps)` 与尽力而为的 `router.syncModelOptionsFromProvider()`。

同一趟还装配两个单例。`RuntimeKnobsStore` 基于 `AtomicJsonFile(data/runtime_knobs.json)`，
保存对 env 默认值的文件级覆盖，其 update 回调热应用 context tuning、harness 重试
预算、tool 预算与 driver knobs。跨 session 记忆 store 为基于
`data/memory_episodic.json` 的 `EpisodicMemory` 与基于 `data/memory_semantic.json`
的 `SemanticMemory`，桥接进一个 `MemoryServiceAdapter`。

返回 `{ settings, app }`，类型为 `RuntimeComponents`。

## Driver 注册

`apps/server/src/load-drivers.ts` 定义 `builtinDriverLoaders`，即七个 backend 的
动态 import。

| Framework id | Leaf |
|---|---|
| `native` | `@agentprism/driver-native` |
| `plan_execute` | `@agentprism/driver-plan-execute` |
| `self_critique` | `@agentprism/driver-self-critique` |
| `langchain` | `@agentprism/driver-langchain` |
| `langgraph` | `@agentprism/driver-langgraph` |
| `autogen` | `@agentprism/driver-autogen` |
| `crewai` | `@agentprism/driver-crewai` |

`registerDriversBestEffort(registry, loaders)` 把失败的后端视为告警而非错误，
因此只有完全空的 registry 才使启动失败。可选 `DRIVERS` env var 限定 loader
子集，未设表示全部内置，未知名称告警并忽略。新增 backend 意味着在此新增一个
loader。见 [../guides/add-a-driver.zh.md](../guides/add-a-driver.zh.md)。

## 路由挂载

`apps/server/src/mount-routes.ts` 按此顺序挂载八个 route leaf：

```
provider → settings → sessions → arena → workspace → projects → builder → threads
```

顺序只在一处重要：`GET /api/sessions/stats` 注册在
`GET /api/sessions/:sessionId` 之前，使单段路径无法吞掉它。

## 测试组合层

- `apps/server/tests/load-drivers.test.ts` 是组合冒烟测试：registry 非空且包含
  `native`。
- `apps/server/tests/mount-routes.test.ts` 检查每个 route leaf 一个 endpoint 加一个
  health 探针。
- `apps/server/tests/assemble.test.ts` 与 `tests/http-transport/` 端到端固定
  请求契约。
