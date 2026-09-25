# `@agentprism/driver-self-critique`

> 语言：**简体中文** | [English](README.md)

Self-Critique framework driver：ReAct executor 循环，每批 tool 后有一次 critic 评估。

- `frameworkId: self_critique`，banner `[Self-Critique]`。
- 每批 tool 之后由一次无 tool 的 critic 调用给进度打 0 到 10 分；低分时注入改向
  消息，每次 run 最多 2 次 critic 强制重试。
- critic 结论经 `reflect` event 承载，使答案提取保持干净。
- 仅消费 harness seam 与 `driver-run-support` 的 run 支持。
