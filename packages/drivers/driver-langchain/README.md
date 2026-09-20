# `@agentprism/driver-langchain`

LangChain driver (`LangChainDriver`, `frameworkId "langchain"`) plus the LC/message bridge (`llm-message-bridge`, `bind-registry-tools`, `bind-tools-safe`, `require-chat-model`, `stream-to-message`, shared with the LangGraph backend). The only place in the repo allowed to translate LC messages; `harness` stays framework-neutral.

## Dependencies

- Runtime: `contracts / driver-registry / harness`, plus `@langchain/core`, `langchain`, `zod`.
