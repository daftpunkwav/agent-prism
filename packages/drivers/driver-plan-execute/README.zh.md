# `@agentprism/driver-plan-execute`

> 语言：**简体中文** | [English](README.md)

Plan-Execute framework driver：planner 一趟写出编号步骤，不使用 tool；随后由
executor ReAct 循环按计划工作，停滞时允许一次有预算的 replan。

- `frameworkId: plan_execute`，banner `[Plan-Execute]`。
- planner 与 replan 的思考经 `reflect` event 承载，使答案提取保持干净。
- 只消费 harness seam，即 `buildSystemUser` 与 `applyContextPipeline`，加上
  `driver-run-support` 的 run 支持；不 import 其他 driver leaf。
