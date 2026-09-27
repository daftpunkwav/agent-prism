# @agentprism/tool-replay

**自定义对比维度**：哪些历史的 tool 结果会回放进模型上下文。对比"全部回放 / 省略只读结果
/ 只留可变操作"。

```
Arena → 维度 "tool_replay"              Builder → 积木块 "Tool-result replay"
  all                                     all（默认）
  skip_read                               skip_read
  writes_only                             writes_only
```

## 它改变什么

| 取值 | 效果 |
|---|---|
| `all` | 每个 tool 调用连同完整结果全部回放（最忠实、上下文最多） |
| `skip_read` | 只读结果（`read`/`glob`/`grep`/`ls`）替换为 `[omitted: read-only tool result]` |
| `writes_only` | 只保留写类结果（`write`/`edit`/`apply_patch`/`bash`/`bash_session`/`run_job`），其余变成标记 |

配对关系在构造上就得以保持：被省略的结果是**替换为标记**而非删除，因此 provider 要求的
assistant/tool 配对在任何 wire 格式下都有效。若钩子直接删除结果，共享的 pair-safety 会
连带丢弃那个失去结果的 tool 调用——那会损失更多。

并行批次（一轮请求多个 tool）中每个结果按自己的 tool 名归属，因此即使同一批里的兄弟调用
被保留，只读结果仍会被省略。

## 使用的钩子

`messages(input, value)` → 模型可见的消息列表。它在 context 策略之后、pair-safety /
sanitize / tool grounding 之前运行。覆盖范围：所有应用共享上下文管道的 driver
（`openai_agents` 与 `claude_agent_sdk` 除外）。

## 使用

在组合根（`apps/server/src/assemble.ts`）与其他 `packages/custom/*` 维度一起注册；
`ARENA_CUSTOM_DIMENSIONS=off` 可一次性关闭。之后对比轴自动出现在 `/api/arena/meta`、
Arena 维度卡片、Builder 积木面板，以及基线面板的 `custom.tool_replay` 字段。

它与 context 策略领域重叠，但是**独立的轴**：context 维度仍决定裁剪策略，本维度决定策略
拿到什么。因此对比 `tool_replay` 只隔离一个变量，而不是把它混进 context 的行里。

## 迁移说明

本维度此前是挂在 `context` 维度下的三个策略。回放粒度本身就是一个独立的对比轴，因此现在
收敛为一个维度——context 维度保留六个内置策略，原三行由本维度承接。

## 依赖

- Runtime：仅 `contracts`（描述符类型）。由宿主注册该维度。
