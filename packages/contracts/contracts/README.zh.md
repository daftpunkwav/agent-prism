# `@agentprism/contracts`

> 语言：**简体中文** | [English](README.md)

全仓库词汇与 port 层：events、enums、校验 schema 与跨 package 接口。**叶子节点，
零 `@agentprism/*` 依赖**，由 `scripts/check-boundaries.mjs` 强制，因此 `runtime`
等基础 package 可以安全依赖它而不成环。

## 设计原则

- 只有形状与契约，没有行为：需要 I/O 或编排的逻辑属于各能力 package。
- Port 以稳定为先：改动这里的接口会改变整个仓库的 seam，因此要同步更新实现方与
  门禁注释。

## 关键 port

| Port | 消费者 |
|---|---|
| `ToolRegistry`，见 `tool-registry.ts` | 由 `tools.MapToolRegistry` 实现；`agent`、`builder`、`drivers` 只消费该类型 |
| `DriverLookup` 与 `AgentDriver`，见 `driver-lookup.ts` 与 `agent-driver.ts` | 由 `drivers.FrameworkDriverRegistry` 实现 |
| `ProviderLookup`，见 `provider-lookup.ts` | 由 `providers.ProviderLookupAdapter` 实现 |
| `LlmAdapter` 与 `LlmMessage`，见 `llm-adapter.ts` 与 `llm-message.ts` | `harness` 与 `drivers` 之间唯一的模型消息语言；LangChain 转换只存在于 `drivers` |
| `PromptSection` 以及 context 与 verification policy，见 `prompt-section.ts`、`context-policy.ts`、`verification-policy.ts` | `harness` 的 section 与 policy registry |

## 依赖

- 依赖：无。第三方仅限纯词汇，例如 `zod`，见 `package.json`。
- 被依赖：仓库中的每个 package。方向始终向下，不允许任何 `@agentprism/*` import。
