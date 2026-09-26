# 配置

> 语言：**简体中文** | [English](configuration.md)

Settings 在启动时经 `packages/config/config/src/settings.ts` 中的 `loadSettings()`
加载一次。仓库根 `.env` 文件，由 `packages/config/config/src/paths.ts` 中的
`ENV_FILE` 定义，与 `process.env` 合并，process env 优先。数字必须是全字符串整数或
小数并通过范围检查。违规以 `SettingsLoadError` 快速失败，进程在坏值上拒绝启动。

下面每个可调项都遵循同一形态：一个带范围检查的 `Settings` 字段，在组合根
`apps/server/src/assemble.ts` 中作为普通 number 选项注入其所属组件。缺失的 key 保留
内置默认值，因此开箱行为等于默认列。

## HTTP 与 auth

| 变量 | 默认 | 用途 |
|---|---|---|
| `BACKEND_HOST` | `127.0.0.1` | 绑定地址；非 loopback 值要求 `API_TOKEN`，并在 `assemble.ts` 中快速失败 |
| `BACKEND_PORT` | `8281` | HTTP 监听端口；启动时必须空闲，无回退 |
| `FRONTEND_PORT` | `8280` | 只喂给 CORS origin allowlist |
| `CORS_ORIGINS` | `""` | 额外允许的 origin，逗号分隔；通配符 `*` 被拒绝 |
| `API_TOKEN` | `""` | 空表示免鉴权；否则 `Authorization: Bearer …` 或 `X-API-Token` |
| `MAX_REQUEST_SIZE` | 10 MiB | 请求体上限，1 KiB 至 1 GiB |

## LLM 播种与模型调用

| 变量 | 默认 | 用途 |
|---|---|---|
| `LLM_PROVIDER_NAME` | `StepFun` | provider-store 播种，仅在 `data/provider_config.json` 缺失或损坏时使用 |
| `LLM_API_KEY` | `""` | 播种 API key |
| `LLM_BASE_URL` | `https://api.stepfun.com/step_plan` | 播种 base URL |
| `LLM_MODEL` | `step-3.7-flash` | 播种模型 |
| `LLM_API_FORMAT` | `anthropic_messages` | `anthropic_messages`、`openai_chat` 或 `openai_responses` |
| `LLM_TEMPERATURE` | `0.0` | 0 至 2 |
| `LLM_TIMEOUT_MS` | `120000` | 每次 chat-model 调用超时，适用于列模型、judge、narrative 与 builder |
| `LLM_MAX_RETRIES` | `2`，范围 0 至 5 | chat model 的 SDK 级瞬时失败重试次数 |
| `LLM_RETRY_DELAY_MS` | `500`，范围 0 至 10 000 | 已解析但当前无消费者：重试由 chat model 的 SDK 承担（`LLM_MAX_RETRIES`），退避由 SDK 自行管理；保留兼容 |

## 并发、breaker 与交互

| 变量 | 默认 | 用途 |
|---|---|---|
| `MAX_CONCURRENT_RUNS` | `4`，范围 1 至 64 | 并行 arena run |
| `MAX_CONCURRENT_COLUMNS` | `8`，范围 1 至 16 | 单次 run 内的列扇出 |
| `BREAKER_THRESHOLD` | `3`，范围 1 至 10 | breaker 跳闸前的连续 endpoint 失败次数 |
| `BREAKER_COOLDOWN_MS` | `30000`，范围 1 000 至 300 000 | breaker half-open 冷却 |
| `ASK_USER_WAIT_MS` | `300000`，范围 10 000 至 600 000 | 降级为 headless defer 前 ask_user 的等待时长 |

## Agent threads

| 变量 | 默认 | 用途 |
|---|---|---|
| `MAX_THREADS` | `24`，范围 1 至 256 | thread registry 上限，必须低于 `MAX_WORKSPACES`，作为快速失败交叉检查 |
| `THREAD_MAX_HISTORY_MESSAGES` | `60`，范围 2 至 1 000 | 持久 transcript 的消息数上限，按 user 与 assistant 对计 |
| `THREAD_MAX_HISTORY_CHARS` | `96000`，范围 64 000 至 2 000 000 | 持久 transcript 字符上限；下限为每条消息钳制的两倍，使最新 turn 得以存活 |
| `THREAD_ANSWER_TAIL_CHARS` | `2000`，范围 200 至 100 000 | 提取一个 turn 的答案时保留的 event 尾部 |

## Workspace 与 stores

| 变量 | 默认 | 用途 |
|---|---|---|
| `MAX_WORKSPACES` | `32`，范围 1 至 256 | workspace registry 配额；每个 thread 可 pin 一个 workspace |
| `WORKSPACE_TTL_SECONDS` | `3600`，范围 60 至 86 400 | TTL 淘汰前的空闲存活时长 |
| `WORKSPACE_LRU_WINDOW_SECONDS` | `300`，范围 30 至 86 400 | 超过该空闲窗口后 LRU 淘汰更倾向某 workspace |
| `FILE_FLUSH_DEBOUNCE_MS` | `300`，范围 50 至 10 000 | `threads.json` 与 `builder_sessions.json` 的写合并窗口 |
| `PROJECT_MAX_COUNT` | `50`，范围 1 至 1 000 | project 归档配额 |
| `PROJECT_SNAPSHOT_MAX_CHARS` | `2000000`，范围 100 000 至 20 000 000 | 每 project 的 workspace 快照上限 |

## Context 策略

这些是每次 LLM 调用的预算，作为 `ContextTuning` 注入每次列 run，策略按调用读取调好
的值。默认值按英文校准。CJK 内容偏重时需要更低的 `CONTEXT_CHARS_PER_TOKEN`。

| 变量 | 默认 | 用途 |
|---|---|---|
| `CONTEXT_WINDOW_MESSAGES` | `12`，范围 1 至 200 | sliding、tool_tail、summary 溢出控制的消息窗口 |
| `CONTEXT_CHARS_PER_TOKEN` | `4`，范围 1 至 16 | 字符代理 token 估算除数 |
| `CONTEXT_SUMMARY_MAX_CHARS` | `4000`，范围 500 至 100 000 | summary 策略溢出摘要在上限 |
| `CONTEXT_TOKEN_BUDGET_CHARS` | `24000`，范围 1 000 至 1 000 000 | token_budget 策略的字符预算 |
| `CONTEXT_TOKEN_BUDGET_KEEP_TURNS` | `6`，范围 0 至 100 | token_budget 绝不牺牲的最新消息数 |
| `CONTEXT_TOOL_TAIL_BUDGET_CHARS` | `4000`，范围 500 至 100 000 | tool_tail 的每 tool 结果修剪预算 |
| `CONTEXT_TOOL_TAIL_KEEP_CHARS` | `1200`，范围 100 至 50 000 | tool_tail 原样保留的尾部字符数，覆盖错误与结论 |
| `CONTEXT_BUDGET_TOKENS` | `6000`，范围 500 至 200 000 | budget 策略的 token 池 |
| `CONTEXT_CHECKPOINT_TARGET_TOKENS` | `2000`，范围 200 至 100 000 | 触发 checkpoint compaction 的溢出目标 |

## 内置 tool 上限与超时

| 变量 | 默认 | 用途 |
|---|---|---|
| `TOOL_OUTPUT_MAX_CHARS` | `32768`，范围 4 096 至 1 048 576 | 截断前的 tool 结果上限 |
| `TOOL_FILE_MAX_CHARS` | `262144`，范围 4 096 至 4 194 304 | 单次 read、write 或 edit 文件上限 |
| `TOOL_RUN_TIMEOUT_DEFAULT_S` | `30`，范围 1 至 600 | 模型省略时 run 与 bash 的超时 |
| `TOOL_RUN_TIMEOUT_MAX_S` | `120`，范围 1 至 3 600 | 模型提供超时的上限，必须至少为默认值，作为快速失败检查 |
| `WEB_FETCH_TIMEOUT_MS` | `15000`，范围 1 000 至 300 000 | web_fetch HTTP 超时 |
| `WEB_SEARCH_TIMEOUT_MS` | `15000`，范围 1 000 至 300 000 | web_search HTTP 超时 |
| `MCP_REQUEST_TIMEOUT_MS` | `30000`，范围 1 000 至 600 000 | 默认每请求 MCP 超时，被 `MCP_SERVERS` 中 per-server 的 `timeoutMs` 覆盖 |
| `MCP_FETCH_TIMEOUT_MS` | `15000`，范围 1 000 至 300 000 | mcp_fetch 每次 fetch 超时 |
| `TOOL_SUBAGENT_MAX_STEPS` | `10`，范围 1 至 40 | 模型提供的 subagent step 预算上限 |
| `TOOL_RALPH_MAX_ROUNDS` | `8`，范围 1 至 64 | 模型提供的 ralph loop 轮次上限 |
| `AGENT_MAX_DELEGATION_DEPTH` | `1`，范围 1 至 3 | subagent 嵌套上限，即仅父到子 |

## Run、流与 server

| 变量 | 默认 | 用途 |
|---|---|---|
| `ARENA_EVENT_RETENTION` | `5000`，范围 500 至 100 000 | 为对比报告保留的每 pipeline event 数 |
| `ARENA_DISCONNECT_GRACE_MS` | `5000`，范围 500 至 60 000 | 客户端断开后的拆除等待时长 |
| `SSE_HEARTBEAT_MS` | `15000`，范围 1 000 至 60 000 | run、matrix、chat、thread 流上的 SSE 注释 ping 间隔，防止代理丢弃静默连接 |
| `SERVER_SHUTDOWN_GRACE_MS` | `5000`，范围 500 至 60 000 | 挂起的优雅关闭被强制退出前的看门狗 |

## 保留为代码

以下刻意不做 env 可调。

- 契约协议上限：arena history 24 000 字符、message 4 000、messages 数组 24、
  attachments 5 乘 64 KiB、endpoint 数 12，等等。这些界定了浏览器与 server 之间的
  协议，两端必须一致。未来的路径是经 `GET /api/arena/meta` 发现 endpoint 提供有效
  上限，遵循 `min_select` 与 baseline 字段范围的先例。上面的服务端 thread 上限是
  env 可调的。
- Driver 算法内部量：reflexion 轮次、critic 改向分数、replan 预算、quiet-turn 阈值。
  这些是算法身份而非部署旋钮，因此按 framework 固定。
- Verification 循环重试预算：harness 的 prompt 文案已声明至多 2 次重试的额度，把它
  做成可调会使 prompt 与行为脱节。
- UI 显示数字，如截断长度、toast 时长、轮询间隔；安全底线，如沙箱命令分析与路径
  规则；以及 token 窗口回退值 `context_window` 128 000、`max_input_tokens`
  120 000、`max_output_tokens` 96 000。token 窗口已在 Provider settings 中按
  endpoint 可配置，这些常量只是省略字段的默认值。

## 在 config loader 之外读取的变量

| 变量 | 读取方 | 用途 |
|---|---|---|
| `MCP_SERVERS` | `apps/server/src/assemble.ts` 到 `tool-mcp/src/config.ts` | stdio MCP server 的 JSON 数组 `{command, args?, env?, timeoutMs?, tools?, name?, enabled?}`；`timeoutMs` 默认 `MCP_REQUEST_TIMEOUT_MS`；仅在 `data/mcp_servers.json` 尚不存在时播种托管 store——运维经 settings API 保存后以文件为准；格式错误的 env JSON 告警一次并被忽略，启动继续 |
| `DRIVERS` | `apps/server/src/load-drivers.ts` | 可选逗号分隔的 driver allowlist，大小写不敏感，如 `native,plan_execute,self_critique`；未设或空白表示全部内置；未知名称告警并忽略 |
| `SEARCH_PROVIDER` | `tool-builtins/src/definitions/web-search.ts` | `exa` 或 `tavily`；其他任何值失败关闭并给出设置提示 |
| `SEARCH_API_KEY` | 同上 | provider key；缺失则失败关闭 |
| `SEARCH_API_URL` | 同上 | 测试用 endpoint 覆盖，默认 Exa 为 `https://api.exa.ai/search`，Tavily 为 `https://api.tavily.com/search` |
| `NEXT_PUBLIC_API_BASE` | `packages/client/client/src/http.ts` | 所有 client URL 的前缀；同源 proxy 无需设置 |
| `ARENA_BASE` | `scripts/run-matrix.mjs` | 运行中 server 的 base URL，默认 `http://localhost:8281` |
| `ARENA_TOT_WIDTH` | `driver-run-support/src/reasoning-constants.ts`（`totWidth`），由 native、langgraph、plan-execute driver 消费 | ToT 分支宽度，钳制 2 至 5，默认 3；server 进程内以 runtime knob 为准——`assemble.ts` 在启动与每次 knobs 热应用时用生效的 knob 值回写该变量 |
| `ARENA_SELF_CONSISTENCY_N` | 同一 helper（`selfConsistencyAttempts`） | self-consistency 尝试次数，钳制 2 至 9，默认 5；模型调用随次数放大；回写优先级相同 |
| `ARENA_CREWAI_PROCESS` | `driver-crewai/src/crew.ts` 与 `driver-crewai/python/bootstrap.py` | `hierarchical` 切换到 manager 流程，其他值保持 `sequential`；回写优先级相同 |
| `ARENA_PYTHON` | `driver-run-support/src/python-probe.ts` | 框架运行时探测的解释器覆盖；未设或空白时依次回退 `python`、`python3` |
| `ARENA_AUTOGEN_RUNTIME` | `driver-autogen/src/autogen-driver.ts` | `python` 强制真实 `autogen-agentchat` 桥（探测不到带该包的解释器即失败关闭），`ts` 强制 TypeScript 模式回退，其他值为 `auto` |
| `ARENA_CREWAI_RUNTIME` | `driver-crewai/src/crewai-driver.ts` | `crewai` 桥的取舍约定与 `ARENA_AUTOGEN_RUNTIME` 相同 |
| `ARENA_CLAUDE_CODE_PATH` | `driver-claude-agent-sdk/src/cli-path.ts` | `claude_agent_sdk` 列所运行的 Claude Code CLI；未设置时回退到全局安装的 Claude Code，再回退到 SDK 自带二进制（已在 `pnpm-workspace.yaml` 的 `ignoredOptionalDependencies` 中跳过）；设置了但文件不存在则立即失败 |

## Runtime knobs

`data/runtime_knobs.json` 保存运维对 env 默认值的覆盖，涵盖 context tuning、harness
重试预算、tool 预算与 driver knobs。`RuntimeKnobsStore` 在启动时加载它们，并经
`GET` 与 `PUT /api/settings/knobs` 热应用更新，因此保存 settings 无需重启即可生效。
文件缺失则保留 env 默认值。

## 技能与 MCP 管理

设置页另有两个托管 store，均无需重启即热应用。
`GET/POST /api/settings/skills`、`PUT/DELETE /api/settings/skills/:name` 与
`PUT /api/settings/skills/:name/enabled` 管理技能目录：内置技能只读（写入以 409
拒绝），自定义技能保存在 `data/skills/<name>/SKILL.md`，停用名单持久化在
`data/skill_settings.json` 并从下一轮运行起过滤生效目录。`GET` 与
`PUT /api/settings/mcp` 整体替换托管 MCP 服务器列表；store 持有共享内存数组供
每次运行读取，保存后立即对下一轮运行生效。

## 凭证引用

经 settings API 存储的 provider endpoint 可持有恰好为 `"${env:NAME}"` 的 API key。
`provider-catalog/src/endpoints.ts` 中的 `resolveCredentialReference` 在构造模型的
唯一消费点解析它。存储值保持为引用，已解析的密钥绝不写回，缺失变量解析为 `""`，
随后在模型构造时失败关闭。不做部分插值。

## 持久化布局

路径定义于 `config/src/paths.ts`。

| 路径 | 内容 | 恢复行为 |
|---|---|---|
| `data/provider_config.json` 与 `.bak` | provider endpoints 与 settings | 主文件损坏则从 `.bak` 恢复；仍不可用则应用 `LLM_*` env 播种 |
| `data/sessions.json` 与 `.bak` | session 账本 `{version:1, sessions:[…]}` | 主文件损坏则从 `.bak` 恢复；陈旧的 `active` 行在加载时翻转为 `failed` |
| `data/sessions.json.blobs/` | 超大账本条目文本，命名为 `<sessionId>.<seq>.blob.txt`，每个至多 128 K 字符 | 删除时按 session 清除 |
| `data/builder_sessions.json` 与 `.bak` | builder session store | 原子写 `.bak` 恢复 |
| `data/threads.json` 与 `.bak` | 持久 agent threads `{version:1, threads:[…]}`，含 transcript、pinned config、workspace 链接 | 原子写 `.bak` 恢复，逐项损坏遏制，陈旧的 `running` 在加载时重置为 idle |
| `data/projects.json` | 归档的 projects | 原子写 `.bak` 恢复 |
| `data/memory_episodic.json` | episodic 记忆条目 | 原子写 `.bak` 恢复 |
| `data/memory_semantic.json` | semantic 记忆事实 | 原子写 `.bak` 恢复 |
| `data/runtime_knobs.json` | 文件级 runtime knob 覆盖 | 原子写 `.bak` 恢复 |
| `data/mcp_servers.json` | 托管 MCP 服务器列表（settings API） | 文件损坏时以 `[mcp-store]` 告警，启动回退到 `MCP_SERVERS` env 播种，文件保持原样 |
| `data/skill_settings.json` | 停用技能名单（settings API） | 读取失败降级为“全部技能启用” |
| `data/skills/<name>/SKILL.md` | 运维创建的自定义技能 | 删除技能时同时清理目录；损坏文件在发现时跳过 |
| `data/runs/<runId>/<workspace>/` | 每列临时 workspace | 重启后重水化，上限 `MAX_WORKSPACES`，TTL 为 `WORKSPACE_TTL_SECONDS`，带 run 中保护的 LRU 淘汰 |
| `data/runs/…/.spills/` | tool 结果与 job 输出 dump，命名为 `spill-*.txt` 与 `NNNNNN-<jobId>.log` | 20 文件轮转 |

所有 JSON 写入经 `@agentprism/persistence` 原子化，使用 `.tmp` 文件、rename、
per-path 写队列与 `.bak` 副本。损坏的单条 session 记录被遏制，而非丢失整个 store。

## 前端配置

`apps/web/next.config.ts` 在 dev 中把 `/api/*` 重写到
`http://127.0.0.1:<BACKEND_PORT>`，依次解析 env、根 `.env`、默认 8281。SSE 需要
`compress: false`，因为 gzip 缓冲会把流保持到完成。安全头包含一个 CSP，其
`connect-src` 为 `'self' ws: wss:`，因此直接的跨源 API 模式需要在那里显式加入后端
origin。
