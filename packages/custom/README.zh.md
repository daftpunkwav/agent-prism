# 自定义对比维度

本目录下**一个包 = 一个对比维度**。每个包声明自己的取值以及取值如何生效的钩子；在组合根
（`apps/server/src/assemble.ts`）注册后，它自动成为 Arena 的一条对比轴、Builder 的一个积木
块、以及基线面板的一个可钉字段——无需改前端。

| 包 | 对比轴 | 钩子 | 对比什么 |
|---|---|---|---|
| [`summary-budget`](summary-budget/README.zh.md) | `summary_budget` | `contextTuning` | 摘要策略保留多少历史摘要（2k / 5k / 8k token） |
| [`memory-top-n`](memory-top-n/README.zh.md) | `memory_top_n` | `memory` | 有多少条召回记忆进入 prompt（前 3 / 前 10 / 全部） |
| [`tool-replay`](tool-replay/README.zh.md) | `tool_replay` | `messages` | 哪些历史 tool 结果回放（全部 / 省略只读 / 只留可变操作） |

每个包自带 README（英文 + `.zh.md`），写明取值表、所用钩子与限制——新增维度不需要改动仓库
其他任何地方，读一个包就能掌握它的一切。

## 新增一个

复制现有包，改 id 与选项，替换钩子，注册，并在 `apps/server/package.json` 加上 workspace
依赖。完整配方、四个钩子槽位、driver 覆盖表与约束见
[`docs/reference/add-a-custom-dimension.zh.md`](../../docs/reference/add-a-custom-dimension.zh.md)。

## 关闭

`ARENA_CUSTOM_DIMENSIONS=off` 可一次性关闭本目录下所有维度（不注册、不产出投影行）。
