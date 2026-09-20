# `@agentprism/memory-store`

> 语言：**简体中文** | [English](README.md)

内存搜索索引与记忆条目的原子文件持久化。

- `MemoryStore` 经 `AtomicJsonFile` 加载并原子持久化带类型的集合。
- `tokenizeText` 切分拉丁词与 CJK 单字和双字，用于稳健的部分匹配。
- 对文本表示做词频排序；跨重启 crash-safe。

## 依赖

- Runtime：`persistence`。
