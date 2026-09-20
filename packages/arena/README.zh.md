# arena/

> 语言：**简体中文** | [English](README.md)

多列并行对比的实验执行层。`arena-routing` 把 dimension 配置路由为可执行 pipeline，
属于纯配置语义，无执行依赖；`arena-runner` 驱动多列并行 run。重执行依赖 `agent`
只存在于 runner leaf。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`arena-routing/`](arena-routing/README.md) | Dimension 路由与 baselines：`DimensionRouter`、`ProviderDimensionSync`、baselines/fields/templates、capability-option 投影 | 由 runner 与组合根消费 |
| [`arena-runner/`](arena-runner/README.md) | 并行多列执行：`ArenaRunner` 与 column-factory port | 由 application 服务与组合根消费 |
