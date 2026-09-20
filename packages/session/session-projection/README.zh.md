# `@agentprism/session-projection`

> 语言：**简体中文** | [English](README.md)

Session 文档上的缓存读投影。

- `projection`：digest 视图，含 record 摘要、entry 窗口与 verdict 汇总。
- `cache`：按 digest 键控的视图缓存，显式失效，无定时器。
- 依赖 `contracts` 的词汇与 `session-format` 的信封。
