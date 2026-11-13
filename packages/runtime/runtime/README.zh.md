# `@agentprism/runtime`

> 语言：**简体中文** | [English](README.md)

Workspace 生命周期 registry（TTL/LRU 淘汰、fork clone、run trace 目录）、semaphore、
event channel、带 timeout/retry helper 的 circuit breaker、`ask_user` 人工通道、clock
与 ID 生成：跨执行层共享的 runtime 原语。

> 与 `apps/server` 的区别：本 package 不监听任何端口，也不装配任何 service；
> `apps/server` 才是完整 application，即组合根加 HTTP host。两者不在同一层，不要
> 混淆。

## 依赖

- Runtime：`contracts / environment`。
