# `@agentprism/context-budget`

> 语言：**简体中文** | [English](README.md)

按来源的 token 预算，带优先级分配与账本。

- `sources`：具名预算来源，含 system、tools、history、retrieval、skills，各带权重。
- `allocate`：按优先级排序的分配器，花掉预算并在账本输出中报告缺口。
- `ledger`：为 prompt 渲染分配账本，即 `[Budget ledger]` 行。
- 零依赖，纯算术，确定性。
