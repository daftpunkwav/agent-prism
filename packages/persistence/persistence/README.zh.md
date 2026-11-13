# `@agentprism/persistence`

> 语言：**简体中文** | [English](README.md)

原子 JSON 文件存储（tmp + `.bak` + rename、损坏源拒绝备份、孤儿 tmp 清扫）与追加式行文件，带 per-path 异步写串行化与 per-key 串行任务队列。在支持 mode 的平台上，写入文件与新建目录为 owner-only（`0o600`/`0o700`；Windows 忽略），因为持久化文档可能携带明文 provider 凭据。零 @agentprism 依赖。

## 依赖

- Runtime：无，叶子节点。
