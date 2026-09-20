# 文档

> 语言：**简体中文** | [English](README.md)

Agent Prism 的文档，按用途分组。当文档与代码冲突时，以代码和
`scripts/check-boundaries.mjs` 为准。

## 架构

系统为什么这样构建。

| 文档 | 摘要 |
|---|---|
| [architecture.zh.md](architecture.zh.md) | 能力族、依赖方向与词汇 |
| [architecture/overview.zh.md](architecture/overview.zh.md) | 概念、分层图、关键 port、设计不变量 |
| [architecture/data-flow.zh.md](architecture/data-flow.zh.md) | 三个执行暴露面的端到端流程，以及状态落在磁盘的哪里 |
| [architecture/sandbox-layers.zh.md](architecture/sandbox-layers.zh.md) | 静态分析、审批闸门、OS 写沙箱 |
| [architecture/composition-root.zh.md](architecture/composition-root.zh.md) | `assemble()` 装配什么、按什么顺序装配，以及启动守卫 |
| [architecture/package-layout.zh.md](architecture/package-layout.zh.md) | family 与 leaf 结构、依赖规则、名称解析 |
| [architecture/decision-register.zh.md](architecture/decision-register.zh.md) | 架构决策及其执行代码 |

## Guides

扩展点及其约束。

| 文档 | 摘要 |
|---|---|
| [guides/getting-started.zh.md](guides/getting-started.zh.md) | 安装、配置 provider、启动两个 server、第一次对比 |
| [guides/add-a-tool.zh.md](guides/add-a-tool.zh.md) | 内置 tool 的暴露面与 toolset 成员规则 |
| [guides/add-a-driver.zh.md](guides/add-a-driver.zh.md) | framework driver leaf、seam 与注册 |
| [guides/add-a-dimension.zh.md](guides/add-a-dimension.zh.md) | 对比 dimension 的词汇、catalog 与暴露面 |
| [guides/add-a-package.zh.md](guides/add-a-package.zh.md) | leaf 结构、注册与边界规则 |

## Reference

| 文档 | 摘要 |
|---|---|
| [reference/http-api.zh.md](reference/http-api.zh.md) | 每个路由：auth、limits、schemas、SSE 语义 |
| [reference/events.zh.md](reference/events.zh.md) | arena event 类型、builder stream chunk、折叠 |
| [reference/tools.zh.md](reference/tools.zh.md) | Toolsets、内置 tool、MCP、output-budget helper |
| [reference/dimensions.zh.md](reference/dimensions.zh.md) | Dimensions、templates、judging、ablation |
| [reference/configuration.zh.md](reference/configuration.zh.md) | 环境变量、凭证引用、`data/` 布局 |
| [reference/threads.zh.md](reference/threads.zh.md) | 持久 fork 与 resume threads |

## Operations

| 文档 | 摘要 |
|---|---|
| [operations/testing.zh.md](operations/testing.zh.md) | 测试分层、runner、名称解析 |
| [operations/quality-gates.zh.md](operations/quality-gates.zh.md) | boundaries、check:deps、typecheck、lint、导出测试与 i18n 门禁 |
| [operations/runbook.zh.md](operations/runbook.zh.md) | 端口、运行模式、存储、故障模式 |

## 相关文档

- 根 [README.md](../README.md)：快速开始与 package 目录。
- [apps/README.md](../apps/README.md)：两个可运行的 application。
- [packages/README.md](../packages/README.md) 与每个 leaf 的 `README.md`：package
  职责与 seam。
- [tests/README.md](../tests/README.md)：测试放置规则。
- [SECURITY.md](../SECURITY.md)：如何私密报告漏洞。
- 根 [LICENSE](../LICENSE)：项目许可证。
- `AGENTS.md`：编码 agent 的规则。
