# `@agentprism/provider-langchain`

SDK adapter leaf: builds chat models from config (including thinking-budget mapping and the unified `LLM_TIMEOUT_MS` timeout), adapts them to `contracts.LlmAdapter`, probes connectivity, and traces LLM traffic. One of only two places in the repo allowed to touch model SDKs directly (the other is the LC side of `driver-langchain`).

## Dependencies

- Runtime: `contracts / provider-capability`, plus `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`.
