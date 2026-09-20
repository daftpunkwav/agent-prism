# `@agentprism/runtime`

> 语言：**简体中文** | [English](README.md)

Workspace registry、semaphore、circuit breaker、clock、ID 生成：无 I/O 编排的同步
原语。

> 与 `apps/server` 的区别：本 package 不监听任何端口，也不装配任何 service；
> `apps/server` 才是完整 application，即组合根加 HTTP host。两者不在同一层，不要
> 混淆。

## 依赖

- Runtime：`contracts / environment`。
