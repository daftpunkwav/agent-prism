# `@agentprism/contracts`

Repo-wide vocabulary and ports layer: events, enums, validation schemas, and cross-package interfaces. **Leaf node: zero `@agentprism/*` dependencies** (enforced by `scripts/check-boundaries.mjs`), so foundation packages like `runtime` can safely depend on it without cycles.

## Design principles

- Shapes and contracts only, no behavior: logic needing I/O or orchestration belongs to the capability packages.
- Ports favor stability: changing an interface here changes the seam of the whole repo, so update implementers and gate comments together.

## Key ports (seam overview)

| Port | Consumers |
|---|---|
| `ToolRegistry` (`tool-registry.ts`) | Implemented by `tools.MapToolRegistry`; `agent`/`builder`/`drivers` consume only this type |
| `DriverLookup` / `AgentDriver` (`driver-lookup.ts`, `agent-driver.ts`) | Implemented by `drivers.FrameworkDriverRegistry` |
| `ProviderLookup` (`provider-lookup.ts`) | Implemented by `providers.ProviderLookupAdapter` |
| `LlmAdapter` / `LlmMessage` (`llm-adapter.ts`, `llm-message.ts`) | The only model-message language between `harness` and `drivers`; LangChain conversion lives only in `drivers` |
| `PromptSection` / context and verification policies (`prompt-section.ts`, `context-policy.ts`, `verification-policy.ts`) | `harness` section / policy registries |

## Dependencies

- Depends on: nothing. Third-party code is pure vocabulary only, for example `zod`, as declared in `package.json`.
- Depended on by: every package in the repo. The direction is always downward; no `@agentprism/*` imports allowed.
