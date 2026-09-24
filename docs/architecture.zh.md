# 架构

Agent Prism 是一个多 pipeline 并行对比平台。本文定义系统结构：能力族、
依赖方向与共享词汇。当本文与代码冲突时，以代码和
`scripts/check-boundaries.mjs` 为准。

> 语言：**简体中文** | [English](architecture.md)

## 1. 设计原则

`packages/<capability-family>/<leaf>` 两级结构建立在三个机制之上。

1. Seam 优先。seam package 只定义抽象服务，不绑定实现。
   `tool-registry` 拥有 `ToolRegistry`，`driver-registry` 拥有
   `DriverLookup`，`provider-capability` 拥有 `ProviderLookup`。实现位于
   独立的 leaf。
2. 后端注册。每个 backend leaf 独立打包和声明，在组合时注册。
   driver backend 注册到 `DriverLookup`：`native` 在进程内运行，
   `langchain` 与 `langgraph` 桥接外部框架，`plan_execute` 与
   `self_critique` 是 native 系列循环。tool 实现注册到
   `ToolRegistry`：`tool-builtins` 与 `tool-mcp`。
3. 显式组合。`apps/server/src/assemble.ts` 装配唯一交付物。
   每个能力族目录在其 `README.md` 中维护 `Package | Role | Seam` 表；
   每个 leaf 提供 `src/`、`tests/`、`README.md`、`package.json` 与
   `tsconfig.json`。

不存在全局 context 对象。装配使用显式参数注入与注册表实例，
组合根唯一。见 [architecture/composition-root.zh.md](architecture/composition-root.zh.md)。

## 2. 能力族映射

`Package | Role | Seam / registration key`。registration key 是该 package
暴露的、可被另一实现替换的 seam 面。

| Package | 职责 | Seam / registration key |
|---|---|---|
| `contracts` | 全仓库词汇与 port 层：events、enums、validation、port interfaces | `ToolRegistry`、`DriverLookup`、`ProviderLookup`、`AgentDriver`、`LlmAdapter` ports；无 registration key，无 @agentprism 依赖 |
| `environment` | 沙箱化文件系统与子进程执行 | `ScopedFileSystem`、`runProcess`；无 registration key |
| `runtime` | Workspace 注册表、semaphore、circuit breaker、clock、ID | 如 `WorkspaceRegistry`、`SystemClock` 等具体构件；无 registration key |
| `persistence` | JSON 原子文件存储 | `AtomicJsonFile`；无 registration key |
| `config` | Settings、paths 与 `.env` 加载 | `loadSettings`；无 registration key |
| `telemetry` | Token 统计与 metrics | `TokenTracker`、`buildMetrics`；无 registration key |
| `harness` | 中性执行语义：context pipeline、prompt 装配、reasoning 模式、verification 循环 | `AgentExecutionContext`、`applyContextPipeline`、`MapPromptSectionRegistry`、`MapContextPolicyRegistry`、`tool-guard` |
| `memory/{memory-store, memory-episodic, memory-semantic, memory-service}` | 跨 session 记忆：原子 store 与搜索索引、episodic 与 semantic 两层、以及 service port adapter | `MemoryServicePort` adapter 消费 `contracts` 与 `persistence`；由组合根挂载 |
| `tools/tool-registry` | Tool seam，无实现 | `MapToolRegistry` 实现 `contracts.ToolRegistry`；`normalizeToolset`、`selectToolNames`、`selectToolRegistry` |
| `tools/tool-builtins` | 内置 tool 实现 | `createBuiltinToolRegistry`，含 read、write、edit、ls、bash、apply-patch、glob、grep、web_fetch、todo_write、ask_user、web_search、run_job、bash_session、subagent、skill、goal、ralph_loop、plan、session_query、symbols、scatter |
| `drivers/driver-registry` | Driver seam 与共享运行时支持 | `FrameworkDriverRegistry` 实现 `contracts.DriverLookup`；`registerDriversBestEffort` 接受注入的 loader，后端失败时告警 |
| `drivers/driver-native` | 进程内 native backend | 以 `native` 注册到 `DriverLookup` |
| `drivers/driver-langchain` | LangChain backend 与 LC/message 桥接 | 以 `langchain` 注册到 `DriverLookup` |
| `drivers/driver-langgraph` | LangGraph reasoning-graph backend | 以 `langgraph` 注册到 `DriverLookup` |
| `drivers/driver-plan-execute` | Plan-Execute backend：planner 一趟加一个 ReAct executor，允许一次有预算的 replan | 以 `plan_execute` 注册到 `DriverLookup` |
| `drivers/driver-self-critique` | Self-Critique backend：无 tool 的 critic 对每批 tool 打分并改向 | 以 `self_critique` 注册到 `DriverLookup` |
| `drivers/driver-autogen` | AutoGen 模式 backend：带 LLM speaker 选择的 group chat | 以 `autogen` 注册到 `DriverLookup` |
| `drivers/driver-crewai` | CrewAI 模式 backend：角色 crew 运行任务 pipeline | 以 `crewai` 注册到 `DriverLookup` |
| `providers/provider-capability` | Provider seam，无 SDK | `ProviderLookupAdapter` 实现 `contracts.ProviderLookup`；`EndpointCatalog`、`ProviderConfigStore` |
| `providers/provider-langchain` | SDK 适配与模型构造 | `createChatModel`、`createColumnRuntime`、`testProviderConnection` |
| `transport/http-runtime` | HTTP 外壳：middleware、health checks、error mapping | `createHttpApplication`、`HttpApplicationDeps`、`HttpApp` |
| `transport/route-*`，8 个 route leaf | 领域路由注册器，含 session 读取/删除、durable threads 与 settings knobs | `register*Routes(app, deps)`，由组合根挂载 |
| `dimensions` | 实验 dimension 目录与选项 | `DimensionCatalog` |
| `agent` | 单列执行生命周期；默认装配 sandbox 拒绝策略 | 无 registration key；消费 `harness`、`tool-registry`、`tool-builtins`、`sandbox` |
| `arena/arena-routing` | Dimension 路由与 baselines | `DimensionRouter`、`ProviderDimensionSync`、`buildCapabilityOptionProjection`、baselines 与 templates |
| `arena/arena-runner` | 并行多列执行 | `ArenaRunner`、column-factory port `contracts.ColumnRuntimeFactory` |
| `evaluation` | 评判与对比报告 | `judgeAnswers`、`buildComparisonReport` |
| `application` | 用例服务：arena、provider、workspace、projects、sessions | `ArenaService`、`ProviderService`、`WorkspaceFileService`、`ProjectStore`、`SessionService` |
| `builder/builder-service` | 装配服务编排：sessions、catalog、热更新 | `BuilderService`、`BuilderSessionStore` |
| `builder/builder-turns` | Turn 执行：drivers、composition、blocks、trace log | `runBuilderTurn`、`BuilderModelRuntimeFactory`、composition 函数 |
| `client` | Web app 的 HTTP/SSE client | 无 registration key；仅依赖 `contracts` |
| `arena-view` | 纯视图投影：column state、trace events、final-answer extraction | 无 registration key；仅依赖 `contracts` |
| `ui` | 展示组件，React peer | 无 registration key；仅依赖 `contracts` |
| `session/session` | 内存 session store 实现，port 在 `contracts` | `InMemorySessionStore` |
| `session/session-persistence` | Session 文件后端 | `FileSessionStore` |
| `sandbox/sandbox` | Shell 安全策略与 hook 适配器 | `DenyListSandboxPolicy`、`toBeforeExecute` |
| `apps/server` | 唯一组合根：注册 drivers、挂载 routes、装配 services、负责端口监听 | `assemble()` |
| `apps/web` | Next.js 前端 | 只能依赖 `client`、`ui`、`arena-view`；门禁强制 |

## 3. 依赖方向

依赖方向在 `pnpm` 声明与实际 `src` import 之间交叉核对，且无环。

```
apps/web ──► client / ui / arena-view ──► contracts
apps/server (assemble) ──► application / arena / drivers / providers / transport / …
http-runtime + route-* ──► application / builder ──► arena ──► agent ──► harness ──► runtime ──► environment
(route-* ──► http-runtime; the shell never depends back on routes)  │          │          └──────► telemetry ──► contracts
                                           │          └─────► tool-builtins ──► tool-registry ──► contracts
                                           └─────► dimensions ──► contracts
driver-* ──► driver-registry ──► harness + telemetry; langchain and langgraph leaves additionally carry @langchain/* external deps
provider-langchain ──► provider-capability ──► config + persistence
evaluation ──► contracts + runtime
client / config / dimensions / ui / arena-view ──► contracts
contracts / environment / persistence ──► no @agentprism dependencies; leaf nodes
```

铁律由 `scripts/check-boundaries.mjs` 强制。声明真实性由
`scripts/check-package-deps.mjs` 经 `pnpm check:deps` 强制。

- `contracts` 导入零个 `@agentprism/*`；`harness` 导入零个 `@langchain/*`。
- `tool-registry` 仅依赖 `contracts`；`tool-builtins` 仅依赖
  `contracts`、`environment`、`tool-registry` 与 `tool-symbols`；`tool-mcp`
  仅依赖 `contracts` 与 `tool-registry`。tool seam 位于 composer 与
  实现两者之下。
- `driver-registry` 仅依赖 `contracts`、`environment`、`runtime`、`telemetry`
  与 `harness`，零 backend 依赖。`driver-native` 与 `driver-langchain`
  额外引入 `driver-registry`；`driver-langgraph` 额外引入
  `driver-langchain`。driver plugin 消费 harness seam，绝不依赖
  composer 或 providers。其与 tools 的关系仅经 `contracts` 类型
  如 `ToolDefinition`，绝不依赖具体 tool package。
- `provider-capability` 仅依赖 `contracts`、`config`、`persistence`、
  `environment`、`runtime` 与 `telemetry`；`provider-langchain` 额外引入
  `provider-capability`。
- `http-runtime` 仅依赖 `application`、`builder`、`config` 与 `contracts`。
  `route-*` 仅依赖 `application`、`builder`、`config`、`contracts` 与
  `http-runtime`。routes 依赖 shell，shell 绝不反向依赖 routes。
  package 层零环。
- `arena` 绝不接触 `@langchain/*` 或 providers。`application` 绝不接触
  provider、evaluation 或 harness 实现。`evaluation` 只接触
  `contracts` 与 `runtime`；LLM 调用经注入的 text seam 抵达，LC adapter
  位于组合根。`dimensions` 只接触 `contracts`。
  `apps/web` 只依赖 client、ui 与 arena-view。
- 注入 seam 专用于有副作用的依赖，如 clocks 与 stores。纯契约层投影
  如 `extractAnswerFromEvents` 直接从 `contracts` 消费，不注入。

## 4. 词汇

以下术语跨 package 反复出现，含义被限定。

- **session**：一次 arena、agent 或 builder run 的执行账本记录，
  `contracts` `SessionKind`，由 `session` family 跟踪。builder 创作 session
  是另一 store，即 `builder-service` `BuilderSessionStore`，不是账本 session。
- **thread**：具备持久 transcript 与 workspace 的 durable agent 会话，
  见 `/api/threads` 与 `ThreadService`，支持跨重启的 fork 与 resume。
- **column**：arena 对比 run 中的一条并行 lane，由一个 pipeline config
  与其 event stream 组成。column label 是 events 与 reports 的聚合键。
- **worker**：执行一个 column 的被 spawn 的 OS 进程，即 runner 中的
  `spawnWorker`。一个 worker 恰好运行一个 column。
- **pipeline**：每列配置包 `PipelineConfig`，在 event 与 report map 中
  用作 label 与 key。
- **job / task / turn**：job 是后台 arena run 进程 `run-job`；task 是
  `task-templates` 中预设的被评判练习；turn 是 builder 或 thread 会话的
  一次请求/响应周期。
- **endpoint 与 model**：endpoint 是已配置的 provider 目标，含 id、base URL
  与 credentials。model 是在该 endpoint 请求的模型名。历史命名中，
  arena dimension id `model` 选择的是 endpoint，其选项值为 endpoint id，
  由 label 消歧。此命名因兼容已持久化的 pipeline config 与 web catalog
  而保留。
