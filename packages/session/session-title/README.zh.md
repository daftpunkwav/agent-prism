# `@agentprism/session-title`

> 语言：**简体中文** | [English](README.md)

确定性 session 标题与 LLM-hook port。

- `normalize`：对标题文本做 trim、collapse 与封顶，带稳定的回退链。
- `title`：首个 prompt 压缩加关键词回退；`Titler` port 支持模型生成标题，失败时
  确定性回退。
- 依赖 `contracts` 的 session 词汇，仅类型。
