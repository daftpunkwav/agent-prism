# providers/

> 语言：**简体中文** | [English](README.md)

LLM provider 配置与模型构造。`provider-catalog` 是无 SDK 的纯 seam，含 endpoint
catalog、config 解析与存储、lookup adapter、thinking budget；`provider-langchain`
承载 OpenAI 与 Anthropic 的 SDK adapter 与模型构造。上层只消费 port 与 catalog 类型，
绝不直接消费 SDK。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`provider-catalog/`](provider-catalog/README.md) | Provider seam：`ProviderLookupAdapter`，实现 `contracts.ProviderLookup`；`EndpointCatalog`、`ProviderConfigStore`、config 解析、thinking budget | Seam，零 SDK 依赖 |
| [`provider-langchain/`](provider-langchain/README.md) | SDK adapter：模型构造 `createChatModel` 与 `createColumnRuntime`、连通性检查、wire tracing | 消费该 seam |
