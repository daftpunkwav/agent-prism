# `@agentprism/driver-langchain`

LangChain driver (`LangChainDriver`, `frameworkId "langchain"`) plus the LC/message bridge (`llm-message-bridge`, `bind-registry-tools`, `bind-tools-safe`, `require-chat-model`, `stream-to-message`), shared with the LangGraph and Deep Agents backends — it also exports the context middleware (`contextPolicyMiddleware`) they mount on their own runtimes. The only place in the repo allowed to translate LC messages; `harness` stays framework-neutral.

## Dependencies

- Runtime: `contracts / driver-run-support / harness`, plus `@langchain/core`, `langchain`, `zod`.
