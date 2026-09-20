# tools/

> 语言：**简体中文** | [English](README.md)

模型可调用 tool 的注册与实现。`tool-registry` 是无实现的纯 seam，含 registry 与
toolset 解析；`tool-builtins` 装配并实现全部内置 tool。`agent` 与 `builder` 只消费
这两个 leaf 的公开面；`driver-langchain` bridge 只消费 `contracts` 的
`ToolDefinition` 类型。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`tool-registry/`](tool-registry/README.md) | Tool seam：`MapToolRegistry`，实现 `contracts.ToolRegistry`；toolset 解析 `normalizeToolset`、`selectToolNames`、`selectToolRegistry` | Seam，零 tool 实现 |
| [`tool-builtins/`](tool-builtins/README.md) | 内置 tool 实现：`createBuiltinToolRegistry`，含 read、write、edit、ls、run、apply-patch、glob、grep、webfetch、todo_write、ask_user、web_search、run_job、bash_session、subagent、skill、goal、ralph_loop、plan、session_query、symbols、scatter | 注册进 `ToolRegistry` |
| [`tool-mcp/`](tool-mcp/README.md) | MCP 挂接 seam：进程内 fs 与 fetch server，以及 `mcp__<server>__<tool>` 命名下的外部 JSON-RPC stdio 桥接 | 在组合根尽力注册 |
| [`tool-symbols/`](tool-symbols/README.md) | 代码 symbol 索引 tool，含 definitions、references、dependents | 在 `tool-builtins` 内注册 |
