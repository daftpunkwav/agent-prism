# `@agentprism/session-telemetry`

> 语言：**简体中文** | [English](README.md)

内存 session 生命周期 telemetry 与确定性报告。

- `counters`：按 kind 统计 started、按 status 统计 finished、entry 计数与时长。
- `report`：用于日志与面板的稳定文本摘要。
- 只观察，不持久化：账本仍是事实来源。
- 依赖 `contracts` 的 session 词汇，仅类型。
