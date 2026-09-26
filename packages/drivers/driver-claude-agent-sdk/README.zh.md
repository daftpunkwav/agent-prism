# `@agentprism/driver-claude-agent-sdk`

> 语言：**简体中文** | [English](README.md)

Claude Agent SDK driver：在子进程中运行 Claude Code 的 agent 循环，Arena 工具经
进程内 MCP server 提供。

- `frameworkId: claude_agent_sdk`，banner `[Claude Agent SDK]`。
- 需要 Anthropic 格式的 Provider 端点（`api_format: anthropic_messages`）：模型调用
  由 CLI 自己发起。列上的 base URL、API Key 与 model 经子进程环境变量传入；与之冲突的
  凭据/厂商开关（`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`、Bedrock/Vertex
  开关）会被清除。
- Claude Code 内置工具全部关闭（`tools: []`）；注册表以进程内 MCP server（名为 `arena`）
  暴露并预先放行，因此每次工具调用都经 `tools.execute`，与其他列走同一受控路径。
- 权限模式为 `dontAsk`（无人应答，直接拒绝而非弹窗）。
- `settingSources: []` 确保开发者本机的 CLAUDE.md/settings 不会混进对比运行。
- CLI 解析顺序：`ARENA_CLAUDE_CODE_PATH` → 全局安装的 Claude Code；SDK 自带的
  每平台 ~245 MB 二进制已在 `pnpm-workspace.yaml`（`ignoredOptionalDependencies`）
  中跳过——想改回内置二进制，删掉对应条目即可。
