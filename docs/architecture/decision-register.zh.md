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
| `apps/web` 只依赖 `client`、`ui`、`arena-view` | 前端保持为 contracts 类型 client 之上的薄视图 | `check-boundaries.mjs` 的 web 规则 |
| Package 私有 | 无任何发布 | 每个 leaf 的 `package.json`、`apps/web` 的 UI 文案 i18n 门禁 |
