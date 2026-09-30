# `@agentprism/tool-mcp`

> 语言：**简体中文** | [English](README.md)

MCP 挂接 seam：把进程内文件系统与 fetch 能力服务器桥接为 tool。

- `McpPolicy`，取值为 `off`、`fs`、`full`，选择挂接哪些 server；
  `mcpToolsForPolicy` 列出它们。
- `registerMcpTools(registry, policy)` 把 server handler 桥接进 `ToolRegistry`，
  使用 `mcp__` 命名。
- 仅依赖 `contracts`；server 以进程内方式跑在 column workspace
  上，无 socket、无外部进程。
- `local-capabilities`、`policy-bridge`（原名 `servers`、`bridge`）：进程内 tool
  定义及其 policy 映射——无 socket；真正的外部进程在 `transport`、`client`
  与 `mcp-servers-store` 注册表。
- `transport`、`client`、`remote-tools`：用于外部 MCP server 的 JSON-RPC stdio
  client，含 handshake、tools/list、tools/call、超时，并以
  `mcp__<server>__<tool>` 命名桥接进 registry。
- `config`：解析 `MCP_SERVERS` env JSON，输入非法时抛错。本地 runtime 尽力把已配置
  server 挂到顶层 run（arena/thread/matrix 列，以及把 `mcp_policy` 设为 `off` 以外
  的 Builder turn）；宕机 server 告警并跳过；嵌套 run 继承文件而不继承
  进程。
- `mcp-servers-store`：`GET`/`PUT /api/settings/mcp` 背后的运维托管 registry。仅在
  `data/mcp_servers.json` 尚不存在时用 env 解析结果播种，之后以文件为准。每次保存
  都经共享 env parser 重新校验，并原地变更同一个共享数组实现热应用，每次运行的
  消费方无需重启即可重载。store 文件损坏时以 `[mcp-store]` 告警并回退到 env 播种。
  server 条目在 env 形态之外接受两个展示字段：`name`（settings 视图显示名）与
  `enabled`（停用的 server 持久保留但不挂接到运行）。
