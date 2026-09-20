# `@agentprism/memory-semantic`

> 语言：**简体中文** | [English](README.md)

Semantic memory：结构化事实、约定与偏好。

- `recordFact` 记录带置信度的 subject/predicate/object 事实。
- 经 `validFrom` 与 `validUntil` 强制有效期窗口，并支持 TTL 过期。
- `recallFacts` 为查询返回相关的未过期事实。
- `SemanticMemoryOptions` 支持可选 `filePath` 持久化与注入 clock。

## 依赖

- Runtime：`contracts / memory-store`。
