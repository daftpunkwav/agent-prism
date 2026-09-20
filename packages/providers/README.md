# providers/

LLM provider configuration and model construction. `provider-capability` is the SDK-free pure seam (endpoint catalog, config parsing/storage, lookup adapter, thinking budget); `provider-langchain` carries the OpenAI / Anthropic SDK adapters and model construction. Upper layers consume only ports and catalog types, never the SDKs directly.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`provider-capability/`](provider-capability/README.md) | Provider seam: `ProviderLookupAdapter` (implements `contracts.ProviderLookup`), `EndpointCatalog`, `ProviderConfigStore`, config parsing, thinking budget | Seam (zero SDK dependencies) |
| [`provider-langchain/`](provider-langchain/README.md) | SDK adapters: model construction (`createChatModel`, `createColumnRuntime`), connectivity checks, wire tracing | Consumes the seam |
