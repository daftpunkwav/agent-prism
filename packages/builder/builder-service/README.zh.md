# `@agentprism/builder-service`

> 语言：**简体中文** | [English](README.md)

Builder service：session 生命周期、catalog、热更新。编排来自 `builder-turns` 的 turn
执行；tool 定义经注入的 catalog sources 传入。

- 每个 session 同时只跑一个 turn：run handle 在首个 chunk 之前占用，并在同一个
  `finally` 中释放，因此首个 chunk 之后立刻断开的消费方（SSE 客户端消失）不会把
  session 留在 "running" 状态。
- 中途脱离的 turn 其执行 ledger 行以 `cancelled` 关闭；ledger 失败只告警，绝不打断
  它所观察的 turn。
- `patchComposition` 在改动任何状态前校验整个 patch（空闲守卫、composition 规范化、
  block 可用性），被拒绝的 patch 既不会改 name，也不会改 composition。
- session 记录与 history 通过 `BuilderSessionStore` 持久化（防抖原子写）；每个
  session 的可观测性 journal 通过 `SessionTraceStore`（JSONL）持久化。

## 依赖

- Runtime：`contracts / persistence / runtime / builder-turns`（`tool-builtins` 是 dev 依赖，供测试使用）。
