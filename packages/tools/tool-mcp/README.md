# `@agentprism/tool-mcp`

MCP attachment seam: in-process filesystem/fetch capability servers bridged as tools.

- `McpPolicy` (`off`/`fs`/`full`) selects which servers attach; `mcpToolsForPolicy` lists them.
- `registerMcpTools(registry, policy)` bridges server handlers into a `ToolRegistry` with `mcp__` names.
- Depends only on `contracts` + `tool-registry`; servers run in-process against the column workspace (no sockets, no external processes).
- `transport`/`client`/`remote-tools`: JSON-RPC stdio client for external MCP
  servers (handshake, tools/list, tools/call, timeouts) plus registry bridging
  under `mcp__<server>__<tool>` names.
- `config`: parses the `MCP_SERVERS` env JSON and throws on invalid input. The local
  runtime attaches configured servers to top-level arena columns best-effort; dead
  servers warn and are skipped. Nested runs inherit files, not processes.

