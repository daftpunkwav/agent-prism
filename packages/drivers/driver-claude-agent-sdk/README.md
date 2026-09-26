# `@agentprism/driver-claude-agent-sdk`

Claude Agent SDK driver: the Claude Code agent loop in a subprocess, with the
Arena tools served over an in-process MCP server.

- `frameworkId: claude_agent_sdk`, banner `[Claude Agent SDK]`.
- Requires an Anthropic-format provider endpoint (`api_format: anthropic_messages`):
  the CLI performs its own model calls. The column's base URL, API key and model are
  passed in the subprocess environment; conflicting credential/provider overrides
  (`ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, Bedrock/Vertex switches) are dropped.
- Claude Code built-in tools are disabled (`tools: []`); the registry is exposed as an
  in-process MCP server named `arena` and pre-approved, so every tool call runs through
  `tools.execute` on the same guarded path as the other columns.
- Permission mode is `dontAsk` (deny rather than prompt): there is no human at the CLI.
- `settingSources: []` keeps a developer's own CLAUDE.md/settings out of a comparison run.
- The CLI is resolved from `ARENA_CLAUDE_CODE_PATH`, else a globally installed Claude Code;
  the SDK's ~245 MB per-platform binary is skipped in `pnpm-workspace.yaml`
  (`ignoredOptionalDependencies`) — remove an entry there to use the bundled binary instead.
