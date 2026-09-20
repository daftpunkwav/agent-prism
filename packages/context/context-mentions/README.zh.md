# `@agentprism/context-mentions`

> 语言：**简体中文** | [English](README.md)

`@file` 提及语法，加 workspace 解析与候选搜索。

- `grammar`：解析、格式化与校验 `@path` 与 `@"spaced path"` 提及，对邮箱安全。
- `resolve`：遍历安全的 workspace 读取与目录列举，渲染为围栏 context 块。
- `search`：对 workspace 文件列表做 prefix、substring、fuzzy 候选排序。
- 仅依赖 `contracts`；文件系统访问是结构性的，由 runtime Workspace fs 满足。
