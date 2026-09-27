# @agentprism/memory-top-n

**自定义对比维度**：召回的记忆有多少进入 prompt。同一任务上对比"前 3 条 / 前 10 条 /
全部召回"。

```
Arena → 维度 "memory_top_n"             Builder → 积木块 "Memory recall depth"
  top3                                    top3（默认）
  top10                                   top10
  all                                     all
```

## 它改变什么

记忆挂载每层有条数上限（`MEMORY_BLOCK_LIMITS`：episodic 3 / semantic 5），该固定预算
会静默截断更丰富的召回。这个维度把该预算变成对比轴：

| 取值 | 效果 |
|---|---|
| `top3` | 每层挂载前 3 条（上下文最紧，默认） |
| `top10` | 每层挂载前 10 条 |
| `all` | 挂载全部召回条目（上下文最宽） |

请与列的 `memory` 积木一起看：设为 `episodic`/`semantic`/`full` 才有召回可塑形；设为
`none` 时没有任何召回，该维度无内容可改。

## 使用的钩子

`memory(input, value)` → 同时调整召回结果与渲染上限。两者缺一不可：只改上限无法放宽
服务层已限制的召回，只截召回又会在渲染时再次被截断。覆盖范围：全部 driver（记忆在
prompt 组装期挂载）。

## 使用

在组合根（`apps/server/src/assemble.ts`）与其他 `packages/custom/*` 维度一起注册；
`ARENA_CUSTOM_DIMENSIONS=off` 可一次性关闭。之后对比轴自动出现在 `/api/arena/meta`、
Arena 维度卡片、Builder 积木面板，以及基线面板的 `custom.memory_top_n` 字段。

## 照抄它

这是"塑形 prompt 挂载态"（而非消息列表）的参考实现——见
[`docs/reference/add-a-custom-dimension.zh.md`](../../../docs/reference/add-a-custom-dimension.zh.md)。

## 依赖

- Runtime：仅 `contracts`（描述符类型）。由宿主注册该维度。
