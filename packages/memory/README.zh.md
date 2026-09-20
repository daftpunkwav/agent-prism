# memory/

> 语言：**简体中文** | [English](README.md)

中性 port 背后的跨 session 记忆。`memory-store` 提供原子持久化与词频搜索索引，
`memory-episodic` 记录任务复盘，`memory-semantic` 记录结构化事实，`memory-service`
把两者桥接为一个 `MemoryServicePort`。`memory` 对比 dimension 选择挂载哪些层到
prompt。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`memory-store/`](memory-store/README.md) | 原子 JSON 持久化加多语言词频搜索索引 | 位于两种记忆之下 |
| [`memory-episodic/`](memory-episodic/README.md) | 任务复盘，带去重与相关性召回 | `memory-service` |
| [`memory-semantic/`](memory-semantic/README.md) | subject/predicate/object 事实，带有效期窗口与 TTL | `memory-service` |
| [`memory-service/`](memory-service/README.md) | 基于 episodic 与 semantic store 的 `MemoryServicePort` adapter | 组合根 |

各 leaf 仅依赖 `contracts` 与 `persistence`，绝不依赖 `harness` 或 `agent`。
