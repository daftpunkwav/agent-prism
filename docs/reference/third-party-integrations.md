# Third-party integrations

Inventory of every external runtime dependency, the boundary that isolates it,
and the decisions recorded by the dependency audit round (baseline `cd642e0`).
When this document disagrees with the code, `package.json` manifests and
`pnpm-lock.yaml` are authoritative.

> Language: **English** | [简体中文](third-party-integrations.zh.md)

## Runtime dependency inventory

Resolved versions are the lockfile pins at audit time; caret ranges resolve
fresh on install.

| Package | Declared | Resolved | Used by | Boundary |
|---|---|---|---|---|
| `zod` | `^4.1.5` | 4.6.1 | application, builder-service, contracts, driver-claude-agent-sdk, driver-openai-agents, driver-run-support, session-persistence | Schema validation at package edges; no deeper penetration |
| `hono` | `^4.6.0` | 4.13.7 | http-runtime, route-arena, route-builder, route-threads, server | Confined to the transport family and the composition root |
| `@hono/node-server` | `^1.13.0` | 1.19.17 | server | Node adapter for the composition root only |
| `next` | `^16.3.3` | 16.3.4 | web | Web app shell |
| `react` / `react-dom` | `19.2.4` (exact) | 19.2.4 | web, ui | Exact pin for Next compatibility; `ui` also declares `^19` peers |
| `geist` | `^1.7.2` | 1.7.2 | web | Font only |
| `lucide-react` | `^1.23.0` | 1.44.0 | ui, web | Icons only |
| `react-markdown`, `remark-gfm` | `^10.1.0` / `^4.0.1` | 10.1.0 / 4.0.1 | web | Markdown rendering only |
| `langchain` | `^1.0.0` | 1.5.11 | driver-langchain | See LangChain boundary below |
| `@langchain/core` | `^1.0.0` | 1.2.10 | driver-deepagents, driver-langchain, driver-langgraph, provider-langchain, server | See LangChain boundary below |
| `@langchain/anthropic` / `@langchain/openai` | `^1.0.0` | 1.5.10 / 1.5.12 | provider-langchain | Model adapters behind the provider port |
| `@langchain/langgraph` | `^1.0.0` | 1.4.14 | driver-deepagents, driver-langgraph | Graph runtime behind the driver port |
| `deepagents` | `^1.14.1` | 1.14.1 | driver-deepagents | Framework adapter leaf |
| `@modelcontextprotocol/sdk` | `^1.29.0` | 1.30.1 | driver-claude-agent-sdk | Type-only today (see MCP boundary) |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.283` | 0.3.283 | driver-claude-agent-sdk | 0.x, no stability guarantee (see below) |
| `@openai/agents` | `^0.18.0` | 0.18.0 | driver-openai-agents | 0.x, no stability guarantee |

## Boundaries

### LangChain v1

The LangChain surface is confined to the packages that exist to adapt it:
`driver-langchain`, `driver-langgraph`, `provider-langchain`, and
`driver-deepagents`. Outside the adapter family, `apps/server/src/assemble.ts`
imports the message/callback classes (`BaseCallbackHandler`,
`HumanMessage`, `SystemMessage`) to hand assembled traces and prompts across
the boundary. These four are the only import sites; do not add new ones in
capability packages — route new integrations through the existing driver and
provider ports.

### MCP (Model Context Protocol)

Two independent integration faces, on purpose:

- `packages/tools/tool-mcp` ships a **self-built JSON-RPC 2.0 stdio client**
  with zero runtime dependencies. It negotiates MCP protocol version
  `2024-11-05` during `initialize` (`src/client.ts`) and covers a bounded
  subset: stdio framing, initialize, tools/list, tools/call, resources/list,
  resources/read, roots. Sampling and prompts are out of scope. Every remote
  failure becomes a loud tool result or a thrown `McpError`.
- `driver-claude-agent-sdk` declares `@modelcontextprotocol/sdk` and uses it
  **type-only** (`CallToolResult` in `src/mcp-tools.ts`); the SDK's runtime
  side is not imported there.

### Claude Agent SDK (0.x)

`@anthropic-ai/claude-agent-sdk` is 0.x with no stability guarantee — expect
breaking changes in minor bumps; review its changelog before any range move.

The bundled per-platform native CLI (~245 MB each) is deliberately skipped via
`ignoredOptionalDependencies` in `pnpm-workspace.yaml`. The launcher is
resolved at runtime by `driver-claude-agent-sdk/src/cli-path.ts`:

- `ARENA_CLAUDE_CODE_PATH` set but missing: **fails loud**
  (`ConfigurationError`).
- Otherwise: global npm prefix, then PATH discovery.
- Nothing found: returns `undefined`, the SDK then fails with its own
  missing-CLI error — also loud, just worded by the SDK.

A `claude_agent_sdk` composition must resolve to an `anthropic_messages` endpoint —
the explicit endpoint pick, else the provider default. `validateComposition` in
`builder-turns/src/composition.ts` rejects other formats at create and swap time
(HTTP 422), and the driver re-checks per column at turn time
(`driver-claude-agent-sdk/src/endpoint.ts`).

### Python dual-runtime bridge

`driver-run-support/src/python-probe.ts` resolves the interpreter
(`ARENA_PYTHON` override, else `python`, else `python3`) and caches per-module
import probes for the process lifetime. Runtime selection per driver:

- `auto` (default): probe; on any failure **silently fall back** to the
  TypeScript pattern runtime.
- `python`: force the framework; a failed probe throws
  (`ARENA_CREWAI_RUNTIME` / `ARENA_AUTOGEN_RUNTIME`).
- `ts`: skip the probe.

Known consequence: installing a Python framework into a live server requires a
restart (the probe result is cached). The arena run record does **not** carry
which runtime actually served a run — adding that field is a wire-contract
change and is deferred (see the audit handoff).

### Hardcoded third-party endpoint defaults

All defaults are overridable by configuration; they exist so a fresh install
runs without extra setup:

| Constant | Value | Site | Override |
|---|---|---|---|
| `DEFAULT_LLM_BASE_URL` | `https://api.stepfun.com/step_plan` | `packages/contracts/contracts/src/provider.ts` | Endpoint settings (`base_url` per LLM endpoint) |
| `EXA_URL` | `https://api.exa.ai/search` | `packages/tools/tool-builtins/src/definitions/web-search.ts` | `SEARCH_API_URL` (+ `SEARCH_PROVIDER=exa`, `SEARCH_API_KEY`) |
| `TAVILY_URL` | `https://api.tavily.com/search` | same file | `SEARCH_API_URL` (+ `SEARCH_PROVIDER=tavily`, `SEARCH_API_KEY`) |

## Test tooling convention

`vitest`, `@testing-library/react`, `jsdom`, and `@vitest/coverage-v8` are
declared once at the workspace root. Leaf packages import them in tests
without redeclaring; this is the accepted monorepo convention, not a phantom
dependency. `scripts/check-package-deps.mjs` intentionally scopes its honesty
checks to `@agentprism/*` packages.

## Audit decisions (this round)

- `pnpm audit`: clean, no known vulnerabilities in any dependency tree.
- Ghost imports: a full-workspace scan found **no** undeclared third-party
  runtime imports (the only hits were Node builtins, root-declared test
  tooling, and Next path aliases).
- Upgrades: every resolved version sits inside its declared caret range and
  only a few patch/minor releases behind latest; with a clean audit and no
  known defects, the audit round shipped **no runtime upgrades** (policy:
  upgrade only for known defects, one package at a time, full suite green).
- `@types/node` unified to `^24` across web, config, and the root (was
  `^20` in web); resolved to a single 24.13.4 pin. Web lint and typecheck
  verified unchanged.
- 0.x SDKs (`@openai/agents`, `@anthropic-ai/claude-agent-sdk`): evaluated,
  documented, not touched.
