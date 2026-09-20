# `@agentprism/context-time`

> 语言：**简体中文** | [English](README.md)

Prompt 的时间锚定与检索 context 的 freshness 预算。

- `timestamp`：UTC 格式化与解析、日边界、注入式 clock，不使用环境时间。
- `invariant`：event 排序的单调性与偏斜守卫。
- `freshness`：按来源的陈旧预算，覆盖 retrieval、snippets、tool output。
- 零依赖，纯函数，确定性。
