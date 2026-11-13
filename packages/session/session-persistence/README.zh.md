# `@agentprism/session-persistence`

> 语言：**简体中文** | [English](README.md)

持久化的 `SessionStore` 后端。两者共享同一套变更语义（上限、清洗、遗留 `active` 迁移为
`failed`、最新优先排序），只在持久化机制上不同：

- `FileSessionStore`（`file-session-store.ts`）：经 `JsonFile` port 维护单个版本化 JSON
  文档；每次变更整文件原子重写。
- `JsonlSessionStore`（`jsonl-session-store.ts`）：append-only op log 加全量快照，经
  `AppendFile` / `JsonFile`。追加为 O(1)，`checkpoint()` 先写快照再截断日志（重放幂等），
  损坏的日志行被计数并跳过（`corruptLines`），追加字节超过预算会自动触发 checkpoint。
  重放会拒绝 JSON 合法但字段类型损坏的行（`at` 非有限数、`seq` 非整数或为负、`metadata`
  非对象），并按与其他损坏行相同的计数方式处理。

共享加载规则：两个后端都按 session 条目隔离损坏（单条坏记录不会清空整个 ledger）；
JSONL 后端会拒绝部分解读容器版本未知的快照，file 后端则保留其宽容恢复路径（未知版本
仍按同样的逐项遏制加载）。超长条目溢出到 `SessionBlobStore` sidecar
（`FileBlobStore`），其文件名会清洗 session id 并做哈希，使清洗后相同的 id 仍互不串扰，
并拒绝非安全整数的序列号，避免把非法值写进路径；在支持 POSIX mode 的平台上，sidecar 以
owner-only（`0o600`）写入 `0o700` 目录。

## 依赖

- Runtime：`contracts / persistence / session`。
