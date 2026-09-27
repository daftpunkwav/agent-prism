# @agentprism/summary-budget

**自定义对比维度**：摘要策略保留多少空间。同一任务上对比 `2k` / `5k` / `8k`
估算 token 的历史摘要，走 Arena 完整管道、事件、报文与报告。

```
Arena → 维度 "summary_budget"           Builder → 积木块 "Summary budget"
  2k tokens                              2k tokens
  5k tokens（默认）                      5k tokens（默认）
  8k tokens                              8k tokens
```

## 它改变什么

`summary` 与 `hybrid` 会把较早的轮次压缩成一条 system 消息，其大小上限由
`ContextTuning.summaryMaxChars` 控制——那是**字符**预算（默认 4000）。这个维度把该
上限变成对比轴：

| 取值 | 效果 |
|---|---|
| `2000` | 摘要约 2000 估算 token（默认除数下约 8000 字符） |
| `5000` | 约 5000 估算 token（默认） |
| `8000` | 约 8000 估算 token：保留最多旧细节，每次调用成本更高 |

token 值按本次运行的 `charsPerToken` 换算，因此运维为中文场景调整除数后该轴含义不变。

只有 `summary`/`hybrid` 会读这个预算：在其他策略上该维度是空操作（列间只剩 prompt 标
记的差异）。请把它与 `summary` 或 `hybrid` 的列对比。

## 使用的钩子

`contextTuning(value, base)` → 返回本次运行的上下文预算补丁。覆盖范围：所有应用共享上
下文管道的 driver（`openai_agents` 与 `claude_agent_sdk` 自持循环，不覆盖）。

## 使用

在组合根（`apps/server/src/assemble.ts`）与其他 `packages/custom/*` 维度一起注册；
`ARENA_CUSTOM_DIMENSIONS=off` 可一次性关闭全部。其余无需配置：对比轴自动出现在
`/api/arena/meta`、Arena 维度卡片、Builder 积木面板，以及基线面板的
`custom.summary_budget` 字段。

## 照抄它

本包是参考实现。要做自己的维度：复制本目录，改包名/id/选项，替换钩子即可——见
[`docs/reference/add-a-custom-dimension.zh.md`](../../../docs/reference/add-a-custom-dimension.zh.md)
（四个钩子槽位、driver 覆盖表与约束）。

## 依赖

- Runtime：仅 `contracts`（描述符类型）。由宿主注册该维度。
