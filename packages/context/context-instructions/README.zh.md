# `@agentprism/context-instructions`

> 语言：**简体中文** | [English](README.md)

分层 agent 指令装配：仓库默认值加 workspace 覆盖。

- `sources`：内置指令层，加仓库与 workspace 的 `AGENTS.md` 发现与优先级。
- `digest`：内容哈希与变更检测，使重新渲染按需付费。
- `render`：预算感知的 section 渲染，带截断标记。
- `state`：持有指令状态，变更时刷新。
- 仅依赖 `contracts`；文件访问是结构性的。
