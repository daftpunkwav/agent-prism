# `@agentprism/provider-catalog`

> 语言：**简体中文** | [English](README.md)

Provider seam：endpoint catalog、config 解析与持久化、lookup adapter、thinking budget。
依赖 `config` 与 `persistence` 主要用于类型；实例由组合根注入，例如 `AtomicJsonFile`，
以保持可替换。

## 依赖

- Runtime：`contracts / config / persistence`，后两者主要用于类型。
