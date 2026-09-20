# session/

> 语言：**简体中文** | [English](README.md)

持久执行 session：arena 与 agent run 的生命周期账本，从 created 到 milestones 再到
done 或 failed，在断开后仍可持久化并重新查询。`session` 是无 IO 的 seam，含 port 与
内存实现；`session-persistence` 是文件后端。注意 builder 创作 session 使用自己的
store，本 family 只跟踪执行 session。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`session/`](session/README.md) | 内存实现：`InMemorySessionStore`，ports 位于 `contracts` | 由 application 服务、测试与组合根消费 |
| [`session-format/`](session-format/README.md) | 带版本的文档信封：迁移链、失败关闭校验 | 由 persistence、projection、query 消费 |
| [`session-persistence/`](session-persistence/README.md) | 文件后端：`FileSessionStore`，单文档原子写、schema 校验、陈旧 active 翻转为 failed | 在组合根注册 |
| [`session-projection/`](session-projection/README.md) | Session 文档上的缓存读投影 | 由 query 暴露面消费 |
| [`session-query/`](session-query/README.md) | 基于 `SessionStore` port 的无依赖查询引擎 | 由 application 服务消费 |
| [`session-telemetry/`](session-telemetry/README.md) | 内存生命周期 telemetry 与确定性报告 | 由 application 服务消费 |
| [`session-title/`](session-title/README.md) | 确定性 session 标题与 LLM-hook port | 由 application 服务消费 |
| [`session-outline/`](session-outline/README.md) | 基于 arena event 流的 turn-outline 投影 | 由 application 服务消费 |
