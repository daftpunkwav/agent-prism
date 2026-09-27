# 对比 dimension

> 语言：**简体中文** | [English](add-a-dimension.md)

dimension 是一条对比变量轴。当前集合在
`packages/contracts/contracts/src/enums.ts` 的 `DimensionIdSchema` 中有 16 个 id：
framework、prompt、reasoning、context、harness、temperature、model、thinking、
thinking_budget、max_steps、toolset、mcp、skill、orchestration、memory、history_mode。

## 词汇

id 加入 `DimensionIdSchema`，并在
`packages/contracts/contracts/src/dimension-field.ts` 的 `DIMENSION_FIELD` 中映射到
其 `PipelineConfig` 字段。恒等映射是常见情况。先例为 `mcp` 映射到 `mcp_policy`、
`skill` 映射到 `skill_policy`、`prompt` 映射到 `prompt_profile`。

## 选项目录

`packages/dimensions/dimensions/src/dimensions/<name>.ts` 保存选项表，含 `value` 与
label 以及默认值，参照 `mcp.ts`、`skill.ts` 或 `orchestration.ts`。存在两种形态：

- static 选项直接列在 catalog 中并原样供给 /meta：temperature、thinking、
  thinking_budget、max_steps、mcp、skill、orchestration、memory、history_mode。
- 受注册表门控的选项在 `STATIC_DIMENSION_OPTIONS` 中起始为空，由启动期能力同步填充：
  `buildCapabilityOptionProjection` 把 static 表过滤到实时注册表，router 的
  `syncCapabilityOptions` 应用结果——即 prompt、reasoning、context、harness、toolset。
  `framework`（driver registry）与 `model`（provider endpoints）则带有 static 种子行，
  由 driver/provider sync 覆盖写。

有默认值的 dimension 在 `STATIC_DEFAULT_BASE` 注册它。

## 语义

dimension 改变每列的一件事。

- prompt profile 作为 `profile:<name>` 走 prompt section registry。
- mcp、skill、orchestration 等策略经执行 context 改变 tool 表或 system prompt。
- 仅 baseline 使用的 baseline decode 字段放入 `BASELINE_ONLY_OPTIONS`，参照
  `top_p`、`frequency_penalty`、`presence_penalty`、`max_output_tokens`。

一次选择恰好隔离该 dimension 的效应。

为什么这不是所有对比想法的路径：**自定义维度包**（`packages/custom/<名字>`）可以声明一整
条新轴——它的取值、钩子、Builder 积木块与基线字段——而无需改 enum、字段表或任何 driver。
只要该变体能用一个维度钩子表达，就用它；只有必须成为一等内置维度时，才按本指南改动。见
[../reference/add-a-custom-dimension.zh.md](../reference/add-a-custom-dimension.zh.md)。

## 继承的暴露面

`DIMENSION_FIELD` 驱动路由与 baseline 透传。`/api/arena/meta` 自动暴露选项。
`buildCapabilityOptionProjection` 与 templates 无需前端硬编码即可拾取该 dimension。

## Guide 与 i18n

`apps/web/src/i18n/content/guide/{en,zh-CN}.ts` 中的 guide 内容增加该 dimension
条目。label 放入 `apps/web/src/i18n/catalogs/{en,zh-CN}/dimensions.ts`，其中 catalog
对等由门禁检查。FieldMatrix 风格的文案计数在两个 locale 更新。

## 测试与文档

选项与默认值在 dimensions leaf 中获得单元测试，catalog 对等在 `apps/web/tests` 下
运行。dimension 行加入 [../reference/dimensions.zh.md](../reference/dimensions.zh.md)
以及 `packages/dimensions/README.md` 的 family 表。
