# `@agentprism/memory-episodic`

> 语言：**简体中文** | [English](README.md)

Episodic memory：过往任务执行的迷你复盘。

- `recordExperience` 记录 goal、tools、errors、self-correction 与 outcome。
- `recallExperiences` 为新任务问题返回最相关的过往经验。
- 同一任务的近似重复报告会被去重。
- `EpisodicMemoryOptions` 支持可选 `filePath` 持久化与注入 clock。

## 依赖

- Runtime：`contracts / memory-store`。
