# `@agentprism/builder-service`

> 语言：**简体中文** | [English](README.md)

Builder service：session 生命周期、catalog、热更新。编排来自 `builder-turns` 的 turn
执行；该 service 自身的重依赖是 tool 装配，即 `tool-builtins`。

## 依赖

- Runtime：`contracts / persistence / runtime / tool-builtins / builder-turns`。
