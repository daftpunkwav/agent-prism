# `@agentprism/driver-openai-agents`

OpenAI Agents SDK driver: the SDK's own run loop (guardrails, handoffs, sessions
and tool dispatch) over the Arena model and tool ports.

- `frameworkId: openai_agents`, banner `[OpenAI Agents SDK]`.
- `ArenaModel` implements the SDK's public `Model` interface over the
  framework-neutral `LlmAdapter`, so provider configuration, wire capture and the
  token ledger stay identical to every other column.
- Registry tools bind as function tools; every call routes through `tools.execute`
  with the same drift guard and result reminder the LangChain column uses.
- Model settings (temperature, max tokens, thinking) come from the configured
  column model; SDK-side `modelSettings` are not re-applied.
