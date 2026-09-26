# Agent Prism

> 语言：**简体中文** | [English](README.md)

多 pipeline 并行对比实验平台。同一个问题在不同 framework、prompt、reasoning mode、
model 与 tool policy 下运行，并把流式结果并排对比。

## 快速开始

```bash
pnpm install
pnpm dev:server   # Backend Hono HTTP (port 8281)
pnpm dev:web       # Frontend Next.js (port 8280)
```

## 架构

### 分层

```
apps/web          Next.js frontend, depends only on client, ui, arena-view
apps/server       Composition root and HTTP host

transport         Hono HTTP thin-protocol layer
application       Use-case services (ArenaService and others)

arena             Dimension routing, parallel Runner, breaker
agent             Single-column execution lifecycle
drivers           Native / LangChain / LangGraph / PlanExecute / SelfCritique / AutoGen / CrewAI
dimensions        Experiment dimension catalog and options
evaluation        Judging and comparison reports
providers         LLM provider config and model construction

harness           Prompt, context, and verification loop
tools             Tool seam, builtins, and MCP
memory            Cross-session memory (episodic and semantic)
session           Execution-session ledger with cancel semantics
builder           Conversational assembly service and turn execution
runtime           Workspace, Semaphore, breaker, Clock
environment       Sandboxed filesystem and child processes
config            Settings, paths, .env
persistence       JSON atomic storage
telemetry         Token and metrics

contracts         Zod enums, event schemas, port definitions; zero-dependency leaf
client            Frontend API client
ui                Shared UI fragments
```

### 依赖规则

1. `contracts` 是叶子。所有 package 都可以依赖它，它不依赖任何业务 package。
2. 组合根只位于 `apps/server/src/assemble.ts`，拥有全部装配。
3. `transport` 是薄协议层：只做 JSON 解析、auth、error mapping 与 SSE 序列化。
4. `arena` 经 `ProviderLookup` port 查询 providers，绝不直接依赖 provider 实现。
5. `dimensions` 经 `REASONING_MODE_META` 读取 reasoning-mode 元数据，绝不依赖
   `harness`。

### `contracts` 中的关键 port

| Port | 用途 | 注入位置 |
|---|---|---|
| `Clock` | 可替换时间源 | WorkspaceRegistry、ArenaRunner、transport |
| `IdGenerator` | 可替换 ID 生成 | WorkspaceRegistry、ArenaRunner、ProviderConfigStore |
| `ProviderLookup` | Provider 查询抽象 | DimensionRouter |
| `AgentDriver` | 唯一的 framework-driver 实现边界 | 由 drivers 实现，由 ArenaRunner 消费 |
| `DriverLookup` | 把 framework id 解析为 driver 的查询 port | 由 FrameworkDriverRegistry 适配，由 ArenaRunner 消费 |
| `ReportPublisher` | 对比报告发布 port | 由 evaluation 适配，由 ArenaRunner 消费 |

`CircuitBreaker` 不是 contracts port。它是 `runtime` 内部有状态的 breaker 原语，
时间源在构造时注入，由 ArenaRunner 按 endpoint 持有。

### 一次 Arena 请求的数据流

```
Web → Next rewrite → transport (CORS and auth) → ArenaService.run()
  → ArenaRunner.streamParallel() → per-column workers
    → AgentDriver.run() → LLM stream → SSE events → Web
```

## 测试

```bash
pnpm test          # full Vitest suite
pnpm typecheck     # whole-repo typecheck; build packages first
pnpm -r build      # build every package, including Next.js
```

## 开发

要求 Node.js >= 20.9 与 pnpm。workspace 成员列于 `pnpm-workspace.yaml`。

```bash
pnpm build         # build all packages
pnpm typecheck     # package typecheck and test typecheck
pnpm test          # Vitest suite
pnpm boundaries    # scripts/check-boundaries.mjs: dependency direction rules
pnpm check:deps    # scripts/check-package-deps.mjs: declared vs imported deps and value-edge cycles
pnpm dev:server    # Hono HTTP backend on 8281
pnpm dev:web       # Next.js frontend on 8280
pnpm start:server  # run the built backend
```

Web app 自带门禁 `pnpm --filter @agentprism/web check:i18n`：检查 `en` 与 `zh-CN` 的
catalog key 对等，并对 `src/app` 与 `src/components` 做 CJK 扫描，确保用户可见文案
绝不绕过 catalog。

### 仓库布局

```
apps/<app>/                composition root (server) and frontend (web); see apps/README.md
packages/<family>/<leaf>/  two-level capability families; every leaf ships src/, tests/,
                           README.md, package.json, and tsconfig.json
tests/<journey>/           cross-domain journey tests through @agentprism/* public exports only
scripts/                   gates (boundaries, deps) and the evaluation matrix runner
docs/                      documentation tree; see docs/README.md for the map
```

每个 package README 都说明其职责、seam 面与依赖方向。`docs/architecture.md` 定义
能力族、依赖方向与共享词汇。

### 约定

- Commit 遵循 Conventional Commits，type 为 `feat`、`fix`、`docs`、`refactor`、
  `chore`、`test`、`perf`，subject 为祈使式且至多 50 字符，每个 commit 一个关注点。
  分支为 `<type>/<kebab-case>`。
- 代码与注释为英文。文档提供英文与简体中文两个版本。用户可见的 UI 文案放在 i18n
  catalog，以 `en` 为规范、`zh-CN` 为镜像，绝不内联。
- sandbox 默认装配 deny-list 策略，在 agent 执行链中阻断不可逆文件系统命令。它是
  护栏，不是安全边界。
- 贡献从 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) 开始（English: [CONTRIBUTING.md](CONTRIBUTING.md)）。
- 编码 agent 遵循 [AGENTS.md](AGENTS.md)。

## Package 目录

| Package | 职责 |
|---|---|
| `contracts` | Zod enums 与 schemas、port interfaces、纯数据类型 |
| `environment` | ScopedFileSystem 与子进程 runner |
| `persistence` | JSON 原子读写 |
| `config` | Settings、paths、`.env` |
| `telemetry` | Token 统计与 metrics |
| `runtime` | WorkspaceRegistry、Semaphore、CircuitBreaker、Clock |
| `context` | 独立 context 能力：chunking、retrieval、mentions、time、analytics、budget、compaction、instructions |
| `tools` | Tool seam、内置 tool、MCP 桥接、共享 tool symbols |
| `harness` | Prompt 构建、context 装配、verification 循环 |
| `memory` | 跨 session 记忆：store、episodic 与 semantic 两层、service port |
| `agent` | 单列 `runAgentExecution` 生命周期 |
| `drivers` | 共享 driver run-support 套件与七个 loop-architecture backend |
| `dimensions` | 实验 dimension 目录与选项 |
| `evaluation` | 评判与对比报告 |
| `providers` | LLM provider config、endpoint catalog、模型构造 |
| `arena` | Dimension 路由、并行 runner、breaker |
| `session` | 执行 session 账本，含 format、outline、projection、query、telemetry、title leaf |
| `builder` | 对话式装配服务与 turn 执行 |
| `sandbox` | Shell 命令安全策略，默认 deny-list |
| `application` | 用例服务层 |
| `transport` | Hono HTTP app，领域路由按 `route-*` leaf 拆分 |
| `client` | 前端 API client |
| `arena-view` | Event-stream 到展示语义：fold、trace、final answer |
| `ui` | 共享 UI 片段 |
