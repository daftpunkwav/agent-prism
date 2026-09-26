# 决策登记表

> 语言：**简体中文** | [English](decision-register.md)

主要架构决策的索引。每一行给出决策、理由，以及执行该决策的代码。

| 决策 | 理由 | 由谁强制 / 体现 |
|---|---|---|
| 无全局 `ctx` 容器 | 显式参数注入与注册表实例即可提供可替换性，无需额外耦合面 | `apps/server/src/assemble.ts` |
| `contracts` 是零依赖叶子 | 全仓库词汇不得拖入运行时依赖 | `scripts/check-boundaries.mjs` 的 contracts 规则 |
| Seam 优先，后端注册 | Drivers、tools、providers 是 `DriverLookup`、`ToolRegistry`、`ProviderLookup` 背后的可替换 leaf | `FrameworkDriverRegistry`、`MapToolRegistry`、`ProviderLookupAdapter` |
| 组合层加固门禁 | 声明真实性与 value-edge 环检测是 CI 红线 | `scripts/check-package-deps.mjs` |
| 两级统一布局 `packages/<family>/<leaf>/` | 每种能力一个形态；布局不改变 package 名 | `pnpm-workspace.yaml` glob `packages/*/*` |
| 纯测试的跨 leaf 引用不声明 devDependencies | 根 vitest alias 解析到 `src`；声明它们会触发 `ERR_PNPM_TASK_CYCLE` | 根 `vitest.config.ts` `workspaceAliases()` |
| 默认启用 sandbox deny-list | agent 链中阻断不可逆文件系统命令；这是护栏，不是安全边界 | `@agentprism/sandbox` `DenyListSandboxPolicy`，经 `beforeExecute` 接入 |
| Session 写入由 service 拥有 | 只有 `SessionService` 用例层写存储；run 绝不直接触碰 | `ArenaService.run`、`safeSession` |
| 账本隔离 | 账本病态只告警，绝不打断被观察的 run | application 中的 `safeSession` 包裹 |
| 客户端 abort 记为 `cancelled` | Cancel 语义与 failure 不同 | contracts `SessionStatus`、route abort 装配 |
| 超大产物先持久化再修剪 | 超预算产物完整 dump 到磁盘并带 locator 与预览，而非静默丢失 | `tool-builtins/definitions/spill.ts`、`session/blob-store.ts` |
| `ask_user` 记录但绝不阻塞 | 不存在同步人工通道，阻塞或伪造答案会产生误导 | `tool-builtins/definitions/ask-user.ts` |
| `subagent` 深度上限 1，toolset 继承减去自身 | 防止无界递归与权限升级 | `agent/agent-execution` 实体 body |
| 凭证引用 `${env:NAME}` | 存储配置保持引用；已解析密钥绝不写回 | `provider-catalog/src/endpoints.ts` `resolveCredentialReference` |
| MCP、skill、orchestration 作为 dimensions | 每次 run 隔离一个变量，使对比保持单变量 | `DIMENSION_FIELD`、`DimensionCatalog` |
| Loop-architecture driver 共享 harness seam | 循环差异必须是架构性的，而非 prompt 后缀 | `driver-plan-execute` 与 `driver-self-critique` 基于 `buildSystemUser` 与 `applyContextPipeline` |
| 双运行时 driver 先探测再运行 | `autogen` 与 `crewai` 保持单一 `AgentDriver` 面：探测到带框架包的解释器时走 Python 框架桥，否则走 TypeScript 模式回退；强制 `python` 时探测失败即失败关闭 | `driver-run-support/src/python-probe.ts` 与 `driver-autogen/src/autogen-driver.ts`、`driver-crewai/src/crewai-driver.ts` 的运行时选择器 |
| SDK backend 跑在共享模型端口上 | OpenAI Agents SDK 自带 run loop 但不自带传输：`ArenaModel` 以 `LlmAdapter` 实现其公开 `Model` 接口，使 Provider 配置、wire 抓包与 token 台账与其他列完全一致 | `driver-openai-agents/src/arena-model.ts`；由 `chat-model-adapter` 在流末产出 usage 保证成真 |
| Claude Agent SDK 列要求 Anthropic 格式端点 | Claude Code CLI 自己发起模型调用，若再走端口就等于第二套传输：driver 把列的 base URL、key 与 model 经子进程环境传入，端点不是 `anthropic_messages` 时按列失败关闭 | `driver-claude-agent-sdk/src/endpoint.ts`、`claudeSubprocessEnv` |
| 框架内置工具不进入 arena 工具面 | Claude Code 内置工具全部关闭（`tools: []`），其自有文件工具只读限定在工作空间；deepagents 保留名（`ls`、`glob`、`grep`）会剔除同名注册表工具，其文件中间件也以只读根植于工作空间。写入与 shell 调用必须经 `tools.execute`，否则列可能绕过自身工具集策略 | `driver-claude-agent-sdk/src/mcp-tools.ts`、`driver-deepagents/deepagents-driver.ts`（`READ_ONLY_FILESYSTEM_TOOLS`、`bindableDefinitions`） |
| 对比运行与宿主 agent 配置隔离 | `settingSources: []` 防止开发者本机 CLAUDE.md/settings 混入 Claude Agent SDK 列；CLI 从 `ARENA_CLAUDE_CODE_PATH` 或全局安装解析，不拉取 SDK 的每平台二进制 | `driver-claude-agent-sdk/src/cli-path.ts`、`pnpm-workspace.yaml` 的 `ignoredOptionalDependencies` |
| `apps/web` 只依赖 `client`、`ui`、`arena-view` | 前端保持为 contracts 类型 client 之上的薄视图 | `check-boundaries.mjs` 的 web 规则 |
| Package 私有 | 无任何发布 | 每个 leaf 的 `package.json`、`apps/web` 的 UI 文案 i18n 门禁 |
