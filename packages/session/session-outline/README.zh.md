# `@agentprism/session-outline`

> 语言：**简体中文** | [English](README.md)

基于 arena event 流的 turn-outline 投影。

- `projection`：把按 turn 分段的 event 纯折叠为每 turn 的 outline，含 prompt 预览、
  response 预览、tool 调用与 verdict，并带 rail 预算。
- 预览预算与 UI 钳制一致，使 turn 在其 event 加载前后读起来完全相同。
- 依赖 `contracts` 的 event 词汇，仅类型。
