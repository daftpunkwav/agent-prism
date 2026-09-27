# `@agentprism/builder-service`

> 语言：**简体中文** | [English](README.md)

Builder service：session 生命周期、catalog、热更新。编排来自 `builder-turns` 的 turn
执行；tool 定义经注入的 catalog sources 传入。

## 依赖

- Runtime：`contracts / persistence / runtime / builder-turns`（`tool-builtins` 是 dev 依赖，供测试使用）。
