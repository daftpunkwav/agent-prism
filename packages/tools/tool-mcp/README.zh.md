# `@agentprism/tool-mcp`

> 语言：**简体中文** | [English](README.md)

MCP 挂接 seam：把进程内文件系统与 fetch 能力服务器桥接为 tool。

- `McpPolicy`，取值为 `off`、`fs`、`full`，选择挂接哪些 server；
  `mcpToolsForPolicy` 列出它们。
- `registerMcpTools(registry, policy)` 把 server handler 桥接进 `ToolRegistry`，
  使用 `mcp__` 命名。
- 仅依赖 `contracts` 与 `tool-registry`；server 以进程内方式跑在 column workspace
  上，无 socket、无外部进程。
- `transport`、`client`、`remote-tools`：用于外部 MCP server 的 JSON-RPC stdio
  client，含 handshake、tools/list、tools/call、超时，并以
  `mcp__<server>__<tool>` 命名桥接进 registry。
- `config`：解析 `MCP_SERVERS` env JSON，输入非法时抛错。本地 runtime 尽力把已配置
  server 挂到 arena 顶层 column；宕机 server 告警并跳过；嵌套 run 继承文件而不继承
  进程。
