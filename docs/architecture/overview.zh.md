# 系统总览

> 语言：**简体中文** | [English](overview.md)

Agent Prism 是一个多 pipeline 并行对比平台：同一个问题在不同 framework、
prompt、reasoning mode、model 与 tool policy 下并排运行，对产生的流式结果
进行对比、评判与归档。

本页是概念地图。[architecture.zh.md](../architecture.zh.md) 定义能力族与依赖规则。

## 核心概念

| 概念 | 含义 | 所在位置 |
|---|---|---|
| **Run** | 一次对比执行：一个问题加每列选择 | `@agentprism/arena` `arena-runner` |
| **Column / pipeline** | 一次 run 内的一条并排变体；SSE `pipeline` 字段是其显示 label 与聚合键 | `contracts/events.ts` `ArenaEventBase` |
| **Dimension** | 一条对比变量轴，共 16 个 id：framework、prompt、reasoning、context、harness、temperature、model、thinking、thinking_budget、max_steps、toolset、mcp、skill、orchestration、memory、history_mode | `contracts/enums.ts`、`@agentprism/dimensions` |
| **Driver** | 实现 `AgentDriver` port 的 loop-architecture backend：native、langchain、langgraph、deepagents、openai_agents、claude_agent_sdk、plan_execute、self_critique、autogen、crewai | `@agentprism/driver-*` |
| **Harness** | 中性执行语义：prompt 装配、context pipeline、reasoning 模式、verification 与 reflection 循环 | `@agentprism/harness` |
| **Toolset** | 具名 tool 表范围：`full` 含 22 个 tool，`edit_run` 含 19 个，`read_only` 含 10 个 | `contracts/enums.ts` `TOOL_NAMES_BY_TOOLSET` |
| **Workspace** | 磁盘上 per-run 或 per-column 的临时目录，位于 `data/runs/<runId>/<workspace>/` | `@agentprism/runtime` `WorkspaceRegistry` |
| **Session ledger** | 持久执行 session 记录，kinds 为 `arena`、`agent`、`builder`，statuses 为 `active`、`completed`、`failed`、`cancelled` | `contracts/session.ts`、`@agentprism/session` |
| **Builder** | 对话式装配服务，用 block 组合出一列并逐 turn 对话 | `@agentprism/builder` |
| **Template** | 带 judge spec 的任务，15 个 scored 与 11 个 quick，用于一键对比矩阵 | `@agentprism/arena-dimensions` `task-templates.ts` |
| **Matrix** | 1 至 8 个 template cell，经 ArenaService 顺序执行并带 SSE 进度 | `@agentprism/application` `MatrixService` |

## 分层图

```
┌─────────────────────────────────────────────────┐
│  apps/web          (Next.js frontend, depends only on client/ui/arena-view) │
│  apps/server (composition root + HTTP host)                          │
├─────────────────────────────────────────────────┤
│  transport         Hono HTTP thin-protocol layer                             │
│  application       Use-case services (ArenaService et al.)                   │
├─────────────────────────────────────────────────┤
│  arena             Dimension routing + parallel Runner + breaker             │
│  agent             Single-column execution lifecycle                         │
│  drivers           Native / LangChain / LangGraph / PlanExecute / SelfCritique / AutoGen / CrewAI │
│  dimensions        Experiment dimension catalog and options                  │
│  evaluation        Judging, comparison reports, ablation rows, matrix        │
│  providers         LLM provider config and model construction                │
├─────────────────────────────────────────────────┤
│  harness           Prompt / context / verification loop                      │
│  tools             Tool seam + builtins + MCP                                │
│  memory            Cross-session memory                                      │
│  session           Execution-session ledger                                  │
│  builder           Conversational assembly service and turn execution        │
│  runtime           Workspace / Semaphore / breaker / Clock                   │
│  environment       Sandboxed FS / child processes                            │
│  config            Settings / paths / .env                                   │
│  persistence       JSON atomic storage                                       │
│  telemetry         Token / metrics                                           │
├─────────────────────────────────────────────────┤
│  contracts         Zod enums / event schemas / port definitions  ← leaf,     │
│                    zero runtime deps                                        │
│  client            Frontend API client        (both depend only on contracts)│
│  ui                Shared UI fragments                                       │
└─────────────────────────────────────────────────┘
```

两级布局 `packages/<family>/<leaf>/` 与各 family 之间的依赖规则见
[package-layout.zh.md](package-layout.zh.md)。逐 family 的角色表见
[packages/README.md](../../packages/README.md)。

## 关键 port，定义在 `contracts`，在组合根注入

| Port | 用途 | 主要消费者 / 实现者 |
|---|---|---|
| `Clock` | 可替换时间源，`now(): number` | WorkspaceRegistry、ArenaRunner、transport routes |
| `IdGenerator` | 可替换 ID 生成，`next(): string` | WorkspaceRegistry、ArenaRunner、ProviderConfigStore |
| `ProviderLookup` | Provider 与 endpoint 查询抽象 | DimensionRouter；arena 绝不接触 provider 实现 |
| `AgentDriver` | 唯一的 framework-driver 实现边界，`run(context): AsyncIterable<ArenaEvent>` | 由 `driver-*` 实现，由 ArenaRunner 消费 |
| `DriverLookup` | 经 `get`、`listAvailable`、`listReserved` 解析 framework id 到 driver | 由 `FrameworkDriverRegistry` 适配 |
| `ToolRegistry` | 组合时注册一次，按 column toolset 选择 | 由 `MapToolRegistry` 实现，由 agent 消费 |
| `LlmAdapter` | 框架中立的 LLM port，含 `stream` 与 `invoke` | 在 `provider-langchain` 实现，由 drivers 桥接 |
| `SessionStore`、`SessionQueryPort`、`SessionBlobStore` | 持久 session 生命周期、只读 agent 查询、超大条目 sidecar | 由 `session` 与 `session-persistence` 实现 |
| `ReportPublisher` | 对比报告发布 | 由 `evaluation` 适配，由 ArenaRunner 消费 |
| `ColumnRuntimeFactory` | 每列 model handle 工厂 | 由 `provider-langchain.createColumnRuntime` 实现 |

`CircuitBreaker` 不是 contracts port。它是 `runtime` 内部有状态的 breaker
原语，时间源在构造时注入，由 ArenaRunner 按 endpoint 持有。

## 设计不变量

1. `contracts` 是叶子。它导入零个 `@agentprism/*`，所有 package 都可以依赖它。
2. 唯一组合根。`apps/server/src/assemble.ts` 是唯一允许构造 driver registry
   与挂载 route leaf 的地方。见 [composition-root.zh.md](composition-root.zh.md)。
3. Seam 优先，后端注册。Drivers、tools 与 providers 暴露
   `DriverLookup`、`ToolRegistry`、`ProviderLookup` 三个 seam；backend 是
   独立的 leaf，在组合时注册。没有全局 `ctx` 容器，只有显式参数注入。
4. 可观测性绝不压过可用性。Session 账本病态，如磁盘满或达上限，只告警，
   绝不打断被观察的 run。
5. 歧义时失败关闭，辅助失败时告警。未知 toolset 回退到 `read_only`；
   未配置的 `web_search` 带设置提示拒绝；spill dump 失败降级为带警告的
   截断而非错误。
6. 边界。静态 shell 分析是护栏，不是安全边界。`sandbox_mode: os`
   在 Windows 上增加 OS 级写入 containment，但不控制读取与网络。
   `ask_user` 绝不阻塞。占位符失败关闭。见 [sandbox-layers.zh.md](sandbox-layers.zh.md)。

## 接下来读什么

- 一次请求如何端到端流动：[data-flow.zh.md](data-flow.zh.md)
- 启动时如何装配：[composition-root.zh.md](composition-root.zh.md)
- 布局与命名约定：[package-layout.zh.md](package-layout.zh.md)
