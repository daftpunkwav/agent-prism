# builder/

> 语言：**简体中文** | [English](README.md)

Agent Builder：以对话方式装配 pipeline。`builder-service` 编排 sessions、catalog 与
热更新；`builder-turns` 执行 turn，经 `agent` 驱动模型调用。重执行依赖 `agent` 与
`arena-view` 只存在于 turns leaf。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`builder-service/`](builder-service/README.md) | Builder service：`BuilderService`、session store | 由 transport 层与组合根消费 |
| [`builder-turns/`](builder-turns/README.md) | Turn 执行：`runBuilderTurn`、composition、blocks、trace log、领域错误 | 由 service leaf 编排 |
