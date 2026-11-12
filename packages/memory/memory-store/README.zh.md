# `@agentprism/memory-store`

> 语言：**简体中文** | [English](README.md)

内存搜索索引与记忆条目的原子文件持久化。

- `MemoryStore` 经 `AtomicJsonFile` 加载并原子持久化带类型的集合，并为其上的记忆包提供
  id 分配与有上限集合的裁剪。持久化文档若不是数组，会告警并以空存储启动，而不是让构造
  过程崩溃。
- `transact` 执行同步编辑并只持久化一次，因此一次裁剪与它腾出空间后插入的条目落在同一
  份快照里。
- `tokenizeText` 切分拉丁词与 CJK 单字和双字，使两种文字都能部分匹配。
- 对文本表示做词频排序；跨重启 crash-safe。

## 依赖

- Runtime：`persistence`。
