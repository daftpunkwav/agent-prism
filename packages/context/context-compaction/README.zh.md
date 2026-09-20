# `@agentprism/context-compaction`

> 语言：**简体中文** | [English](README.md)

面向通用 message 暴露面的 checkpoint 式 compaction。

- `surface`：turn 帧暴露面，带 token 计量，使用字符代理，并支持区间选择。
- `checkpoint`：带标记的 checkpoint 信封，含 `<compacted-summary>` 段、抽取式填充，
  以及接受 LLM 填充的异步 summarizer port。
- `journal`：只追加的 compaction 日志，支持撤销即 pop 与序号守卫。
- 零依赖，纯数据结构，确定性。
