# `@agentprism/session-persistence`

> 语言：**简体中文** | [English](README.md)

文件后端：`FileSessionStore` 经 `JsonFile` port 持久化，单版本文档、整文件原子写、
读侧 schema 校验与截断。损坏文件以空启动，`persistence` 会先尝试 `.bak` 恢复；上一
进程遗留的 `active` session 在加载时翻转为 `failed`，因为只有当前进程拥有执行状态。

## 依赖

- Runtime：`contracts / persistence / session`。
