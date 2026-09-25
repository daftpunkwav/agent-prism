# Framework driver

> 语言：**简体中文** | [English](add-a-driver.md)

driver 是 `AgentDriver` port 背后的一个 loop-architecture backend，该 port 在
`packages/contracts/contracts/src/agent-driver.ts` 中声明
`run(context): AsyncIterable<ArenaEvent>`。已注册的 backend 为 `native`、
`plan_execute`、`self_critique`、`langchain`、`langgraph`、`autogen`、`crewai`，由
`apps/server/src/load-drivers.ts` 加载。

## Leaf 放置

driver leaf 位于 `packages/drivers/driver-<name>/`，遵循
[../architecture/package-layout.zh.md](../architecture/package-layout.zh.md) 中的
leaf 结构。依赖规则由 `pnpm boundaries` 强制：

- 允许：`contracts`、`environment`、`runtime`、`telemetry`、`harness` 与
  `driver-run-support`。
- 禁止：providers、tool package、arena、agent、transport。tool 访问仅经
  `contracts` 类型如 `ToolDefinition`。
- 外部 SDK 依赖如 `@langchain/*` 只存在于需要它们的 leaf。`driver-langgraph` 还可
  引入 `driver-langchain` 以复用共享 LC 桥接。

## Harness seam

driver 复用 `buildSystemUser`、`applyContextPipeline`，以及来自 `driver-run-support`
的共享 event translation，使循环差异保持为架构差异而非 prompt 差异。reasoning-mode
行为属于 driver 自身的控制流，并在下述 reasoning 支持表中评级。

## Event 输出

driver 产出带 pipeline label 的 `ArenaEvent`。运行时侧的 `stampEvent` 会回填缺失的
`turn` 字段，但 turn 数据错误的 event 会破坏 turn 过滤与答案提取，因此字段由
driver 准确设置。reasoning 与 planner 的思考经 `reflect` event 承载，使答案提取
保持不被污染；答案提取读取最后一条 thought，否则最后一条 observation。

## Banner 与支持表

driver banner 加入 `PIPELINE_BANNER_PREFIX` 单一来源，`driver-banner-consistency`
测试跨 backend 锁定 banner。capability 后缀逐 column 保持可复现。`driver-run-support`
中的 reasoning 支持表按 reasoning mode 把每个 driver 评为 structural、budget 或
skeleton。

## 注册

loader 加入 `apps/server/src/load-drivers.ts` 中的 `builtinDriverLoaders`。注册是
尽力而为，失败的后端只告警，组合冒烟测试
`apps/server/tests/load-drivers.test.ts` 固定 loader 表内容。`framework` dimension
选项经 `DimensionCatalog.syncCapabilityOptions` 从 driver registry 运行时同步，web
从 `/api/arena/meta` 读取它们，因此无需硬编码前端列表。

## 约束

- driver 绝不自行构造模型。列模型经注入的 `ColumnRuntimeFactory` 抵达，由
  `provider-langchain.createColumnRuntime` 实现。
- 取消传播。driver 尊重 context 的 abort signal，遵循 subagent abort rethrow 语义。
- 失败的 driver 注册只告警，但空的 registry 使启动失败。
