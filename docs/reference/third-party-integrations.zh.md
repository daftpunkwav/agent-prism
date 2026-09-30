# 第三方集成

全部外部 runtime 依赖的清单、隔离它们的边界，以及依赖审计轮（基线 `cd642e0`）
记录的决策。当本文档与代码不一致时，以 `package.json` 清单和
`pnpm-lock.yaml` 为准。

> 语言：[English](third-party-integrations.md) | **简体中文**

## Runtime 依赖清单

Resolved 为审计时点的 lockfile 版本；caret 范围在安装时解析到更新版本。

| 包 | 声明范围 | Resolved | 使用方 | 边界 |
|---|---|---|---|---|
| `zod` | `^4.1.5` | 4.6.1 | application、builder-service、contracts、driver-claude-agent-sdk、driver-openai-agents、driver-run-support、session-persistence | 包边缘的 schema 校验，不向深处渗透 |
| `hono` | `^4.6.0` | 4.13.7 | http-runtime、route-arena、route-builder、route-threads、server | 限定在 transport 家族与 composition root |
| `@hono/node-server` | `^1.13.0` | 1.19.17 | server | 仅 composition root 的 Node adapter |
| `next` | `^16.3.3` | 16.3.4 | web | Web 应用外壳 |
| `react` / `react-dom` | `19.2.4`（精确） | 19.2.4 | web、ui | 为 Next 兼容性精确锁定；`ui` 另声明 `^19` peer |
| `geist` | `^1.7.2` | 1.7.2 | web | 仅字体 |
| `lucide-react` | `^1.23.0` | 1.44.0 | ui、web | 仅图标 |
| `react-markdown`、`remark-gfm` | `^10.1.0` / `^4.0.1` | 10.1.0 / 4.0.1 | web | 仅 Markdown 渲染 |
| `langchain` | `^1.0.0` | 1.5.11 | driver-langchain | 见下方 LangChain 边界 |
| `@langchain/core` | `^1.0.0` | 1.2.10 | driver-deepagents、driver-langchain、driver-langgraph、provider-langchain、server | 见下方 LangChain 边界 |
| `@langchain/anthropic` / `@langchain/openai` | `^1.0.0` | 1.5.10 / 1.5.12 | provider-langchain | provider port 之后的模型 adapter |
| `@langchain/langgraph` | `^1.0.0` | 1.4.14 | driver-deepagents、driver-langgraph | driver port 之后的图运行时 |
| `deepagents` | `^1.14.1` | 1.14.1 | driver-deepagents | 框架 adapter 叶子 |
| `@modelcontextprotocol/sdk` | `^1.29.0` | 1.30.1 | driver-claude-agent-sdk | 目前仅类型使用（见 MCP 边界） |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.283` | 0.3.283 | driver-claude-agent-sdk | 0.x，无稳定性承诺（见下） |
| `@openai/agents` | `^0.18.0` | 0.18.0 | driver-openai-agents | 0.x，无稳定性承诺 |

## 边界

### LangChain v1

LangChain 接触面收敛在为适配它而存在的包：`driver-langchain`、
`driver-langgraph`、`provider-langchain`、`driver-deepagents`。adapter 家族之外，
`apps/server/src/assemble.ts` 引入消息/回调类（`BaseCallbackHandler`、
`HumanMessage`、`SystemMessage`）以跨越边界传递 trace 与 prompt。这四处是全部
import 站点；不要在 capability 包新增站点——新的集成一律走既有 driver 与
provider port。

### MCP（Model Context Protocol）

刻意保持两个独立的集成面：

- `packages/tools/tool-mcp` 自建 **JSON-RPC 2.0 stdio 客户端**，零 runtime
  依赖。`initialize` 握手协商 MCP 协议版本 `2024-11-05`（`src/client.ts`），
  覆盖有界子集：stdio 分帧、initialize、tools/list、tools/call、
  resources/list、resources/read、roots。Sampling 与 prompts 不在范围内。
  远端失败一律变成响亮的 tool result 或抛出 `McpError`。
- `driver-claude-agent-sdk` 声明 `@modelcontextprotocol/sdk` 但**仅类型使用**
  （`src/mcp-tools.ts` 的 `CallToolResult`）；该处不引入 SDK 的运行时。

### Claude Agent SDK（0.x）

`@anthropic-ai/claude-agent-sdk` 处于 0.x，无稳定性承诺——minor 升级可能带
breaking，移动版本范围前先读 changelog。

各平台原生 CLI（每个约 245 MB）通过 `pnpm-workspace.yaml` 的
`ignoredOptionalDependencies` 刻意跳过。launcher 由
`driver-claude-agent-sdk/src/cli-path.ts` 在运行时解析：

- `ARENA_CLAUDE_CODE_PATH` 已设置但文件不存在：**fail-loud**
  （`ConfigurationError`）。
- 否则：全局 npm prefix，再 PATH 探测。
- 都找不到：返回 `undefined`，SDK 随后以自己的 missing-CLI 错误失败——同样
  响亮，只是错误文案来自 SDK。

`claude_agent_sdk` composition 必须解析到 `anthropic_messages` 端点——显式选择的
端点，否则 provider 默认端点。`builder-turns/src/composition.ts` 的
`validateComposition` 在创建与 swap 时即拒绝其他格式（HTTP 422），driver 在运行期
逐列复查（`driver-claude-agent-sdk/src/endpoint.ts`）。

### Python 双运行时桥

`driver-run-support/src/python-probe.ts` 解析解释器（`ARENA_PYTHON` 覆盖，
否则 `python`、`python3`），并把模块 import 探测结果缓存到进程生命周期。
每个 driver 的运行时选择：

- `auto`（默认）：探测；任何失败**静默回退** TypeScript pattern 运行时。
- `python`：强制框架；探测失败抛错（`ARENA_CREWAI_RUNTIME` /
  `ARENA_AUTOGEN_RUNTIME`）。
- `ts`：跳过探测。

已知后果：向运行中的 server 安装 Python 框架后需要重启（探测结果有缓存）。
arena run 记录**不**携带实际服务该次 run 的运行时——补该字段是 wire 契约
变更，已延后（见审计 handoff）。

### 硬编码的第三方端点默认值

全部默认值均可被配置覆盖；存在意义是让全新安装零配置即可运行：

| 常量 | 值 | 位置 | 覆盖方式 |
|---|---|---|---|
| `DEFAULT_LLM_BASE_URL` | `https://api.stepfun.com/step_plan` | `packages/contracts/contracts/src/provider.ts` | 端点设置（每个 LLM endpoint 的 `base_url`） |
| `EXA_URL` | `https://api.exa.ai/search` | `packages/tools/tool-builtins/src/definitions/web-search.ts` | `SEARCH_API_URL`（+ `SEARCH_PROVIDER=exa`、`SEARCH_API_KEY`） |
| `TAVILY_URL` | `https://api.tavily.com/search` | 同一文件 | `SEARCH_API_URL`（+ `SEARCH_PROVIDER=tavily`、`SEARCH_API_KEY`） |

## 测试工具约定

`vitest`、`@testing-library/react`、`jsdom`、`@vitest/coverage-v8` 只在
workspace 根声明一次。叶子包的测试直接 import 而不重复声明；这是既定的
monorepo 约定，不是幽灵依赖。`scripts/check-package-deps.mjs` 有意把诚实性
检查限定在 `@agentprism/*` 包。

## 本轮审计决策

- `pnpm audit`：干净，全部依赖树无已知漏洞。
- 幽灵导入：全 workspace 扫描未发现未声明的第三方 runtime import（仅命中
  Node 内置模块、根声明的测试工具与 Next 路径别名）。
- 升级：所有 resolved 版本都在声明的 caret 范围内，只落后 latest 数个
  patch/minor；audit 干净且无已知缺陷，本轮**不做 runtime 升级**（策略：
  仅为已知缺陷升级，逐包进行，全量测试绿）。
- `@types/node` 统一为 `^24`（web 原为 `^20`），收敛到单一 24.13.4。web 的
  lint 与 typecheck 验证无变化。
- 0.x SDK（`@openai/agents`、`@anthropic-ai/claude-agent-sdk`）：已评估、
  已文档化、不动。
