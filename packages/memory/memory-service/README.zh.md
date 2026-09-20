# `@agentprism/memory-service`

> 语言：**简体中文** | [English](README.md)

基于 episodic 与 semantic store 的 `MemoryServicePort` adapter。

- `MemoryServiceAdapter` 把 record 与 recall 调用转发到匹配的 store。
- `recallAll` 在单个结果中组合两个 store。
- 它的存在使组合根可以注入一个由具体文件后端 store 构建的单一 port。

## 依赖

- Runtime：`contracts / memory-episodic / memory-semantic`。
