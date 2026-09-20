# `@agentprism/session-format`

> 语言：**简体中文** | [English](README.md)

带版本的 session 文档信封，含迁移链与校验。

- `envelope`：`{version, record, entries}` 文档形态与文件名规则。
- `migrate`：v1 到 v2 迁移，回填 summary、metadata、entryCount；未知版本抛错。
- `validate`：结构校验与失败关闭的错误分类。
- 依赖 `contracts` 的 session 词汇。
