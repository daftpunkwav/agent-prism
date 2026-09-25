# packages/

> 语言：**简体中文** | [English](README.md)

`packages/` 下的一切都按 `<family>/<leaf>/` 两级组织。family 目录聚合相关 leaf，并
携带一张角色表 `README.md`；每个 leaf 都是真实的 workspace package，命名为
`@agentprism/<leaf>`，在 `pnpm-workspace.yaml` 中 glob 为 `packages/*/*`，提供
`src/ tests/ README.md package.json tsconfig.json`。

各 family 之间的依赖方向由 `pnpm boundaries` 与 `pnpm check:deps` 固定；family 角色、
seam 面与铁律的完整映射见 [docs/architecture.zh.md](../docs/architecture.zh.md)。
测试放置遵循 [tests/README.zh.md](../tests/README.zh.md)。

## Families

| Family | Leaves | 职责 |
|---|---|---|
| [`contracts/`](contracts/README.md) | contracts | 全仓库词汇与 port 层：Zod enums 与 schemas、event 契约、port interfaces；所有东西都依赖的零依赖 leaf |
| [`environment/`](environment/README.md) | environment | 沙箱化文件系统 `ScopedFileSystem` 与子进程 runner |
| [`persistence/`](persistence/README.md) | persistence | JSON 原子读写 `AtomicJsonFile` |
| [`config/`](config/README.md) | config | Settings、paths、`.env` 加载 |
| [`telemetry/`](telemetry/README.md) | telemetry | Token 记账与 metrics |
| [`runtime/`](runtime/README.md) | runtime | WorkspaceRegistry、Semaphore、CircuitBreaker、Clock |
| [`context/`](context/README.md) | chunking, retrieval, mentions, time, analytics, budget, compaction, instructions | 面向 prompt 与检索的独立 context 能力，前四个接入 harness |
| [`tools/`](tools/README.md) | tool-registry, tool-builtins, tool-mcp, tool-symbols | Tool seam、内置 tool、MCP 桥接、共享 tool symbols |
| [`harness/`](harness/README.md) | harness | 中性执行语义：prompt 装配、context pipeline、reasoning 模式、verification 循环 |
| [`memory/`](memory/README.md) | memory-store, memory-episodic, memory-semantic, memory-service | 跨 session 记忆：原子 store 与搜索索引、episodic 与 semantic 两层、以及 service port adapter |
| [`agent/`](agent/README.md) | agent | 单列执行生命周期 |
| [`drivers/`](drivers/README.md) | driver-run-support, driver-native, driver-langchain, driver-langgraph, driver-plan-execute, driver-self-critique, driver-autogen, driver-crewai | Driver 共享运行支持（run-support）与七个 loop-architecture backend |
| [`dimensions/`](dimensions/README.md) | dimensions | 实验 dimension catalog 与选项 |
| [`evaluation/`](evaluation/README.md) | evaluation | 评判、对比报告、ablation 行、matrix 聚合 |
| [`providers/`](providers/README.md) | provider-catalog, provider-langchain | Provider seam，含 catalog、config、lookup；以及 LangChain SDK 模型构造 |
| [`arena/`](arena/README.md) | arena-dimensions, arena-runner | Dimension 路由与 baselines、并行多列 runner |
| [`session/`](session/README.md) | session, session-persistence, session-format, session-outline, session-projection, session-query, session-telemetry, session-title | 执行 session 账本：store 加 format、outline、projection、query、telemetry、title leaf |
| [`builder/`](builder/README.md) | builder-service, builder-turns | 对话式装配服务与 turn 执行 |
| [`sandbox/`](sandbox/README.md) | sandbox | Shell 命令安全策略，默认 deny-list |
| [`application/`](application/README.md) | application | 用例服务层，含 ArenaService、SessionService 等 |
| [`transport/`](transport/README.md) | http-runtime, route-arena, route-builder, route-projects, route-provider, route-sessions, route-settings, route-threads, route-workspace | Hono HTTP 外壳与各领域 route leaf |
| [`client/`](client/README.md) | client | 前端 HTTP/SSE API client |
| [`arena-view/`](arena-view/README.md) | arena-view | Event-stream 到视图投影：fold、trace、final answer |
| [`ui/`](ui/README.md) | ui | 共享 UI 片段 |

表的顺序镜像根 [README](../README.zh.md) 的分层图：顶部是 leaf 词汇与基础设施，中间
是执行语义，底部是协议与视图关注点。
