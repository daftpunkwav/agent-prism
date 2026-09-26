/**
 * @file content/guide/zh-CN
 * @description The /guide page's long-form content (zh-CN source of truth).
 *
 * Responsibilities:
 * - Own hero copy, overview/boundary sections, dimension docs, and tables
 *
 * Its inferred GuideContent type is the shape contract en.ts is annotated
 * against; the dev-only drift guards stay on this module.
 */

import { DIMENSION_IDS, type DimensionId } from "@agentprism/client";
import type { DimDoc, GuideHero, GuideSection, Reality } from "./types";

const fieldMatrix: Array<{
  dimension: DimensionId;
  type: string;
  defaultValue: string;
  lockedWhen: string;
}> = [
  {
    dimension: "framework",
    type: "string",
    defaultValue: "native",
    lockedWhen: "对比「框架」时",
  },
  {
    dimension: "prompt",
    type: "PromptProfile",
    defaultValue: "zero_shot",
    lockedWhen: "对比「提示词」时",
  },
  {
    dimension: "reasoning",
    type: "ReasoningMode",
    defaultValue: "react",
    lockedWhen: "对比「推理模式」时",
  },
  {
    dimension: "context",
    type: "ContextStrategy",
    defaultValue: "sliding",
    lockedWhen: "对比「上下文」时",
  },
  {
    dimension: "harness",
    type: "HarnessLevel",
    defaultValue: "bare",
    lockedWhen: "对比「Harness」时",
  },
  {
    dimension: "temperature",
    type: "float 0–2",
    defaultValue: "来自 Provider（吸附到 0 / 0.3 / 0.7 / 1）",
    lockedWhen: "对比「温度」时",
  },
  {
    dimension: "model",
    type: "string",
    defaultValue: "Provider.default_endpoint_id",
    lockedWhen: "对比「模型」时",
  },
  {
    dimension: "thinking_budget",
    type: "number",
    defaultValue: "0",
    lockedWhen: "对比「思考预算」时；0 = 跟随档位",
  },
  {
    dimension: "thinking",
    type: "ThinkingLevel",
    defaultValue: "接入点默认（不支持则 off）",
    lockedWhen: "对比「思考强度」时",
  },
  {
    dimension: "max_steps",
    type: "int 1–40",
    defaultValue: "10",
    lockedWhen: "对比「最大步数」时",
  },
  {
    dimension: "toolset",
    type: "ToolsetId",
    defaultValue: "full",
    lockedWhen: "对比「工具集」时",
  },
  {
    dimension: "mcp",
    type: "McpPolicy",
    defaultValue: "off",
    lockedWhen: "对比「MCP」时",
  },
  {
    dimension: "skill",
    type: "SkillPolicy",
    defaultValue: "on_demand",
    lockedWhen: "对比「Skill」时",
  },
  {
    dimension: "orchestration",
    type: "OrchestrationMode",
    defaultValue: "direct",
    lockedWhen: "对比「编排」时",
  },
  {
    dimension: "memory",
    type: "MemoryPolicy",
    defaultValue: "none",
    lockedWhen: "对比「记忆」时",
  },
  {
    dimension: "history_mode",
    type: "HistoryMode",
    defaultValue: "minimal",
    lockedWhen: "对比「历史」时",
  },
];

/** Multi-turn conversation mechanics doc (columns share history; not a PipelineConfig field). Consumed only via overviewSections, not exported. */
const MULTI_TURN_DOC = {
  summary:
    "Arena 支持在同一组对比列上连续追问：各列共享 `messages` 对话历史，每轮仅 `question` 变化。历史不含本轮输入，由前端在运行成功后追加 user/assistant 对。",
  mechanics: [
    "请求体：`question`（本轮）+ `messages[]`（此前 user/assistant 交替历史，最多 24 条）。",
    "各对比列接收相同 `messages` 与 `question`，仅 PipelineConfig 在对比维上不同。",
    "驱动经 `buildInitialMessages(system, user, history)` 组装：System → 历史 → 本轮 Human。",
    "SSE 事件携带 `turn`（1-based）：后端按 `Math.floor(messages.length / 2) + 1` 派生，供前端按轮分段展示。",
  ],
  limits: [
    "单条消息最长 4000 字符；历史总字符上限 24000（超出则请求校验失败）。",
    "工作空间在列级别持久：多轮追问不会重置各列已写入的文件。",
    "自动判分针对每轮最终答案独立触发；对比报告可按轮次折叠查看。",
  ],
  modules: [
    "packages/contracts/contracts/src/arena.ts · ChatMessage / ArenaRunRequest.messages",
    "packages/harness/harness/src/prompt/assembly.ts · buildInitialMessages",
    "packages/arena/arena-runner/src/runner.ts · history 透传与 turn 标注",
  ],
};

/** Comparison display forms (segmented by turn, not a new comparison dimension). */
const COMPARE_FORMS: Array<{ title: string; body: string }> = [
  {
    title: "Trace 按轮折叠",
    body: "TraceView 以 `turn` 字段将事件分组：每轮显示本轮 question 与各列 Thought / Action / Observation 流。历史轮次可折叠，聚焦当前轮差异。",
  },
  {
    title: "TraceDiff 轮内对齐",
    body: "TraceDiff 在选定轮次内逐步对齐各列事件：同一步骤的 thought / action / observation 并排比较，避免跨轮混杂。",
  },
  {
    title: "报告按轮汇总",
    body: "对比报告保留列级硬指标（耗时、Token、工具次数）；多轮时按轮展示判分与指标，便于观察「随对话深入」的行为漂移。",
  },
  {
    title: "非对比维字段",
    body: "轮次（turn）是 SSE 展示元数据，不是 PipelineConfig 字段，也不出现在基线面板。多轮实验仍遵循控制变量法：每轮只变对比维，其余基线一致。",
  },
];

const PIPELINE_STAGES: Array<{
  title: string;
  detail: string;
  module: string;
}> = [
  {
    title: "请求入场",
    detail:
      "前端 POST /api/arena/run，携带 dimension、selections、baseline、messages（共享历史）与 question（本轮）。服务端用 Semaphore 限制并发。",
    module: "transport/routes/arena.ts · application/arena-service.ts",
  },
  {
    title: "路由展开",
    detail:
      "DimensionRouter.route 为每个选中子项生成 PipelineConfig；基线覆盖写入非对比维；对比维字段被忽略。",
    module: "arena/router.ts",
  },
  {
    title: "并行 Worker",
    detail:
      "每列一个 worker；经 DriverLookup 端口按 config.framework 取 AgentDriver；异常收敛为 SSE error，不拖垮其它列。",
    module: "arena/runner.ts",
  },
  {
    title: "工作空间",
    detail:
      "每列独占磁盘目录 data/runs/<run_id>/<label>/；read/write/edit/bash 路径 jail 在该 cwd。",
    module: "agent/run-workspace.ts · environment/scoped-filesystem.ts",
  },
  {
    title: "列装配",
    detail:
      "构造列模型（temperature、model、思考参数随列注入）；buildInitialMessages 叠加 Prompt / 推理 / Harness / 上下文提示。",
    module: "contracts/column-runtime.ts · providers/model-factory.ts · harness/prompt",
  },
  {
    title: "编排执行",
    detail:
      "Native 循环或薄框架桥（LangChain 家族、SDK 桥）；SSE 含 tool_progress / file_diff；尾部 report 事件含硬指标+产物+叙事。",
    module: "drivers/* · harness/verification/harness-runner.ts · evaluation/report.ts",
  },
  {
    title: "流式回传",
    detail:
      "各 backend 均产出 → thought / action / observation / token_update / complete：LangChain 家族（LangChain、LangGraph、Deep Agents）经 astream_events，Native 与循环变体直接产出，SDK 桥按各自流翻译；前端 Trace 渲染。",
    module: "drivers/event-translation.ts",
  },
  {
    title: "清理",
    detail:
      "运行结束 unprotect 工作空间、RAG 缓存随列丢弃；模型与工具面按列构造，无跨列状态。",
    module: "agent/agent-execution.ts finally",
  },
];

const BASELINE_RULES: Array<{ title: string; body: string }> = [
  {
    title: "UI 锁定",
    body: "当前对比维对应的基线下拉 disabled；收起摘要按管线 / 解码 / 接入点分组列出基线。",
  },
  {
    title: "后端忽略",
    body: "基线解析跳过对比维对应的字段（arena/baseline.ts），即使请求体带了该字段也不生效。",
  },
  {
    title: "取值校验",
    body: "覆盖值必须落在该维选项的 value 集合内，否则路由报错，无静默回退。",
  },
  {
    title: "类型归一",
    body: "temperature / max_steps 从选项字符串转为 float / int 再写入 PipelineConfig。",
  },
  {
    title: "与 Provider 关系",
    body: "未覆盖时 model_id、temperature 默认来自 Settings 持久化配置；对比温度维时请求级全局 temperature 不会抹平各列。",
  },
  {
    title: "多轮历史共享",
    body: "messages 在列间相同，不随对比维变化；各列仅在本轮 run 的 PipelineConfig 上分化。历史由前端维护，后端校验条数与总字符上限。",
  },
];

const toolsetTable: Array<{
  id: string;
  label: string;
  tools: string;
}> = [
  {
    id: "full",
    label: "全工具",
    tools: "read, write, edit, ls, bash, apply_patch, glob, grep, web_fetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter（coding agent 默认面）",
  },
  {
    id: "edit_run",
    label: "编辑+运行",
    tools: "read, write, edit, bash, apply_patch, glob, grep, todo_write, ask_user, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter",
  },
  {
    id: "read_only",
    label: "只读",
    tools: "read, ls, glob, grep, subagent, skill, ralph_loop, scatter, session_query, symbols",
  },
];

const dimensions: DimDoc[] = [
  {
    id: "framework",
    label: "框架",
    reality: "full",
    summary:
      "切换 Agent 循环驱动（Native / Plan-Execute / Self-Critique / LangChain / LangGraph / Deep Agents / OpenAI Agents SDK / Claude Agent SDK / AutoGen / CrewAI）。在相同工具面、相同磁盘工作空间与相同基线下，比较不同循环实现的行为差异。",
    controls:
      "框架维强制 react + full 工具面；ArenaRunner 为每列经 DriverLookup 端口取用对应 AgentDriver，Native 为默认自研循环。",
    options: [
      {
        value: "native",
        label: "Native",
        effect: "自研 while 循环：采样 → tool 执行 → 回填；推理/上下文/Harness 策略在 agent 包内生效。",
      },
      {
        value: "langchain",
        label: "LangChain",
        effect: "create_agent 薄包装同一工具注册表。",
      },
      {
        value: "langgraph",
        label: "LangGraph",
        effect: "ReAct StateGraph 薄包装同一工具注册表。",
      },
      {
        value: "plan_execute",
        label: "Plan-Execute",
        effect: "planner 先写编号步骤，再由执行器循环推进，停滞时一次预算内重规划（reflexion 下两次）。",
      },
      {
        value: "self_critique",
        label: "Self-Critique",
        effect: "ReAct 执行 + 每批工具后数字 critic 打分；低分在有限预算内重定向。",
      },
      {
        value: "deepagents",
        label: "Deep Agents",
        effect: "createDeepAgent 中间件栈：规划工具、虚拟文件系统与子代理委派，复用同一工具注册表。",
      },
      {
        value: "openai_agents",
        label: "OpenAI Agents SDK",
        effect: "SDK 自带 Runner（护栏、交接、会话）；Arena 模型端口实现其 Model 接口，注册表工具作为 function tool 派发。",
      },
      {
        value: "claude_agent_sdk",
        label: "Claude Agent SDK",
        effect: "子进程内跑 Claude Code 循环：关闭内置工具，Arena 工具经进程内 MCP 提供；需要 anthropic_messages 端点。",
      },
      {
        value: "autogen",
        label: "AutoGen",
        effect: "群聊 + LLM 发言人选择：coder 提出工具调用，user proxy 真实执行，reviewer 点评；TERMINATE 结束会话。",
      },
      {
        value: "crewai",
        label: "CrewAI",
        effect: "角色班组（researcher / coder / reviewer）按任务流水线推进；hierarchical 模式由 manager 指派（ARENA_CREWAI_PROCESS）。",
      },
    ],
    path: [
      "非框架维：router 强制 framework=native，避免 LangChain 上推理仅 Prompt 差异。",
      "ArenaRunner 按 config.framework 从 DriverLookup 端口取 AgentDriver。",
      "每列 cwd = data/runs/<run_id>/<label>/ 磁盘目录，工具 read/write/edit/bash 均 jail 在该目录。",
    ],
    langChain: "LangChainDriver：create_agent 薄包装，同一工具注册表 → LC tools。",
    langGraph: "LangGraphDriver：最小 ReAct 图 + 同一工具注册表。",
    modules: [
      "packages/agent/agent/src/agent-execution.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
      "packages/drivers/driver-langgraph/src/langgraph-driver.ts",
      "packages/drivers/driver-plan-execute/src/plan-execute-driver.ts",
      "packages/drivers/driver-self-critique/src/self-critique-driver.ts",
      "packages/drivers/driver-autogen/src/autogen-driver.ts",
      "packages/drivers/driver-crewai/src/crewai-driver.ts",
      "packages/drivers/driver-deepagents/src/deepagents-driver.ts",
      "packages/drivers/driver-openai-agents/src/openai-agents-driver.ts",
      "packages/drivers/driver-claude-agent-sdk/src/claude-driver.ts",
      "packages/arena/arena-runner/src/runner.ts",
    ],
    baselineTip: "测 Prompt / 推理 / 上下文 / Harness 时框架基线保持 native；仅对比框架维时才切换其他框架。",
    caveats: [
      "Deep Agents 静态保留 ls/glob/grep 三个内置工具名（本列会剔除注册表中的同名工具），并以自带的只读文件工具读取工作空间；所有写入仍走 Arena 工具面。",
      "Claude Agent SDK 需要 anthropic_messages 格式的 Provider 端点，以及宿主机上的 Claude Code CLI（可用 ARENA_CLAUDE_CODE_PATH 指定）。",
      "框架维 baseline 的 toolset/reasoning 会被 router 统一为 react + full。",
      "LangChain / LangGraph 未安装时对应驱动跳过注册，不影响 native。",
    ],
  },
  {
    id: "prompt",
    label: "提示词",
    reality: "full",
    summary:
      "只切换 Prompt 模板层（system / user_suffix），不改图结构、工具绑定或上下文裁剪逻辑。适合隔离「文案策略」对格式遵从、推理深度与工具选择的影响。",
    controls:
      "buildPromptParts 的 profile 参数 → PROFILES[profile]；在 system 与 user 段注入模板差异。",
    options: [
      {
        value: "zero_shot",
        label: "Zero-shot",
        effect: "基础 system；无示例后缀。",
      },
      {
        value: "few_shot",
        label: "Few-shot",
        effect: "system 挂载三段完整示范（创建并验证 / 修复崩溃 / 多步改造），每段含任务、工具序列、观察与 artifact 路径。",
      },
      {
        value: "cot_prompt",
        label: "CoT Prompt",
        effect: "system 要求逐步 Thought；user 加 Let’s think step by step。",
      },
      {
        value: "structured",
        label: "Structured",
        effect: "最终答案经一次受 schema 约束的调用重述（plan/files/how_to_run JSON；OpenAI 走 response_format，Anthropic 走强制工具选择）；任何失败保留原始答案。",
      },
      {
        value: "terse",
        label: "Terse",
        effect: "极简措辞、工具优先；差异体现在 token 指标而非判分。",
      },
    ],
    path: [
      "列装配时 buildSystemUser 按 config 组装消息：profile / reasoning / harness / 上下文 hint 逐段叠加。",
      "先取 PROFILES，再叠加推理模式段、Harness 段、上下文策略 hint。",
      "因此「提示词维」变化的是 profile 段；其它叠加段由基线决定。",
      "多轮时 profile 段每轮重建，历史 Human/AI 消息保留在 messages 中不受 profile 覆盖。",
    ],
    langChain: "与 LangGraph 相同：都经 buildSystemUser 组装；差异不在框架侧。",
    langGraph: "同上。",
    modules: ["packages/harness/harness/src/prompt/prompt-builder.ts", "packages/harness/harness/src/prompt/assembly.ts", "packages/harness/harness/src/structured-finalize.ts", "packages/contracts/contracts/src/structured-output.ts"],
    baselineTip: "对比框架时可用 structured 检验格式遵从是否因编排而不同；多轮实验可用 few_shot 观察示例是否被后续轮次「记住」。",
    caveats: [
      "「CoT Prompt」≠ 推理维的 CoT+Tool：前者只改文案，后者改 LangGraph 节点。",
      "structured 模板在多轮追问中可能因历史干扰而降低 JSON 遵从率，需结合 Trace 逐步排查。",
    ],
  },
  {
    id: "reasoning",
    label: "推理模式",
    reality: "full",
    summary:
      "控制 Agent 真实控制流（非 Prompt 标签）。Native 驱动下 react / cot_tool / tot / reflexion / self_consistency 走不同分支；非框架维一律 native。",
    controls:
      "native 驱动循环在采样前后切换 phase；tot 真分支（按宽度独立生成候选、各自独立打分、argmax 选用），self-consistency 跑 N 次独立尝试后多数投票，reflexion 硬顶重试次数（reasoning-graphs 同语义）。",
    options: [
      {
        value: "react",
        label: "ReAct",
        effect: "agent ↔ tools 循环：Thought → Action → Observation。",
      },
      {
        value: "cot_tool",
        label: "CoT+Tool",
        effect: "think → act → tools；先完整推理再行动。",
      },
      {
        value: "tot",
        label: "ToT",
        effect: "真分支：ARENA_TOT_WIDTH（默认 3）次独立候选调用、各自独立打分，argmax 胜者进入执行。",
      },
      {
        value: "reflexion",
        label: "Reflexion",
        effect: "execute ↔ tools → reflect；可按反思再进入执行。",
      },
      {
        value: "self_consistency",
        label: "Self-Consistency",
        effect: "ARENA_SELF_CONSISTENCY_N（默认 5）次独立尝试，每次全新上下文，终答多数投票；native 与 LangGraph 结构化实现。",
      },
    ],
    path: [
      "router 非框架维强制 framework=native。",
      "native 循环：cot_tool 首轮禁工具 → react；tot 按宽度跑 生成/打分 配对后 argmax；reflexion 反思后可能重跑；self-consistency 整任务重跑 N 次后投票。",
      "Plan-Execute：planner 按模式换形（tot 用独立 planner 候选与打分分支；cot_tool 先写推理链；reflexion 重规划预算翻倍）。",
      "Self-Critique：reflexion 多一次 critic 重定向；其余模式共用同一阈值。",
      "self-consistency 在 native 与 LangGraph 为结构化实现；plan_execute / self_critique / langchain 仅 prompt 级支持（见能力 banner）。",
      "事件流含 thought / action / observation / file_diff / tool_progress。",
    ],
    langChain: "框架维 LangChain 列仍用 react 图；推理维对比请用 native。",
    langGraph: "框架维 LangGraph 列为 ReAct 壳；推理维对比请用 native。",
    modules: [
      "packages/harness/harness/src/reasoning/reasoning-modes.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
      "packages/drivers/driver-langgraph/src/reasoning-graphs.ts",
      "packages/drivers/driver-plan-execute/src/plan-execute-driver.ts",
      "packages/drivers/driver-self-critique/src/self-critique-driver.ts",
    ],
    baselineTip: "对比本维时保持框架基线 native；与 Prompt 维的 cot_prompt 文案策略不同。",
    caveats: [
      "ToT 的分支调用（2 × ARENA_TOT_WIDTH）与 self-consistency 的 ×N 次尝试会显著增加 Token 与耗时；self-consistency 的 max_steps 按每次尝试计（总成本至多 N × max_steps 次调用）。",
      "reflexion 重试有硬顶次数，Trace 中可见反思段。",
    ],
  },
  {
    id: "context",
    label: "上下文",
    reality: "full",
    summary:
      "控制每次 LLM 调用前如何裁剪、摘要或检索补充消息历史。直接影响多轮对话中「早期轮次信息是否被保留」——是与多轮实验关系最紧密的对比维之一。",
    controls:
      "prepareMessagesForLlm(strategy) 真实裁剪；vector/hybrid 每次模型调用前检索工作空间片段 + Prompt 层策略文案叠加。",
    options: [
      {
        value: "sliding",
        label: "滑动窗口",
        effect: "保留最近窗口；向前扩展以保持 AI tool_calls 与 ToolMessage 成对。",
      },
      {
        value: "summary",
        label: "摘要压缩",
        effect: "溢出段压缩为摘要块，再拼最近窗口。",
      },
      {
        value: "vector",
        label: "向量检索",
        effect: "窗口裁剪 + 工作区 TF-IDF 检索；片段以 Human 注入（避免多 system）。",
      },
      {
        value: "hybrid",
        label: "混合策略",
        effect: "摘要 + 向量检索组合。",
      },
      {
        value: "tool_tail",
        label: "工具尾部剪枝",
        effect: "保留全部轮次；超预算工具结果原地 head+tail 压紧（列表保 head，日志保错误 tail）。",
      },
      {
        value: "token_budget",
        label: "Token 预算适配",
        effect: "按全局字符预算适配：旧工具结果先丢、推理最后丢，并附 [Budget ledger] 明示。",
      },
    ],
    path: [
      "Prompt 组装注入策略说明文案。",
      "LangChain：每次模型调用前经 prepareMessagesForLlm 裁剪。",
      "LangGraph：图内每次 LLM 调用按 context_strategy 经 prepareMessagesForLlm 裁剪。",
      "sanitize 会合并/压平非前缀 System 消息，兼容 Anthropic。",
      "多轮时 messages 随轮次增长，滑动窗口与摘要策略的差异在第 2 轮起即显现。",
    ],
    langChain: "调用前真实裁剪；与策略文案叠加。",
    langGraph: "图内每次 LLM 调用真实裁剪。",
    modules: [
      "packages/harness/harness/src/context/messages.ts",
      "packages/harness/harness/src/context/tool-tail.ts",
      "packages/harness/harness/src/context/token-budget.ts",
      "packages/harness/harness/src/context/sanitize.ts",
      "packages/harness/harness/src/memory/rag.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
    ],
    baselineTip: "长工具链或多轮追问任务优先测 summary / vector / hybrid / tool-tail / token-budget；建议至少跑 3 轮再下结论。",
    caveats: [
      "vector 依赖当前工作区已有文件；空工作区时检索为空。",
      "多轮共享 messages 时，各列上下文策略不同会导致「同一历史、不同裁剪」——这正是本维要测量的效应。",
      "摘要策略可能丢失精确数字或代码细节，判分失败时需回看被压缩的轮次。",
    ],
  },
  {
    id: "harness",
    label: "Harness",
    reality: "full",
    summary:
      "给每列驱动执行外层叠加验证 / 反思 / 自进化控制循环，用于检验「失败后能否自动纠正」。",
    controls:
      "runVerificationLoop 在 agent 执行内包裹各框架 driver.run：失败按 verify/reflect/self_evolve 反馈重试；Prompt 组装另行追加 Harness 纪律段。",
    options: [
      {
        value: "bare",
        label: "裸运行",
        effect: "单次驱动执行，无验证重试。",
      },
      {
        value: "verify",
        label: "验证循环",
        effect: "结束后 verify_result，失败可原样重跑（最多 2 次含首次），各框架一致。",
      },
      {
        value: "reflect",
        label: "反思循环",
        effect: "失败后 reflect_on_failure，把反思注入再试，各框架一致。",
      },
      {
        value: "self_evolve",
        label: "自进化",
        effect: "失败后 propose_harness_edit（经注入清洗），修改后再试，各框架一致。",
      },
    ],
    path: [
      "runVerificationLoop 在 agent 执行内包裹 driver.run：非 bare 提取答案 → verify → 可选 reflect/edit → 重建反馈后重试（最多 2 次含首次）。",
      "Prompt 组装另行追加 Harness 纪律段，循环行为与文案纪律同时变化。",
      "SSE 可出现 verify / reflect / harness_edit 事件，按 turn 分段展示。",
      "多轮追问时 Harness 仅作用于本轮 run 内的重试，不跨轮累积。",
    ],
    langChain: "同一包裹：create_agent 执行经共享验证循环重试。",
    langGraph: "同一包裹：编译后的推理图执行经共享验证循环重试。",
    modules: [
      "packages/harness/harness/src/verification/loop.ts",
      "packages/agent/agent/src/agent-execution.ts",
    ],
    baselineTip:
      "Harness 重试会增加单轮耗时与 Token；ablation 行与步骤摘要可区分轮次与轮内重试。",
    caveats: [
      "自进化的 prompt 增补有长度与注入清洗；不会执行任意代码。",
      "重试即使失败也消耗 token；ablation 行的 judge 增减说明循环是否划算。",
    ],
  },
  {
    id: "temperature",
    label: "温度",
    reality: "full",
    summary:
      "LLM 采样温度，直接控制输出随机性与探索程度。对比本维时各列温度不同，其余解码参数由基线钉死，适合隔离「随机性」对稳定性与创造性的影响。",
    controls:
      "列装配时 createColumnModel 注入 config.temperature；对比维时跳过请求级全局 temperature。",
    options: [
      { value: "0", label: "0", effect: "偏确定性。" },
      { value: "0.3", label: "0.3", effect: "轻度随机。" },
      { value: "0.7", label: "0.7", effect: "中等探索。" },
      { value: "1", label: "1.0", effect: "更高随机。" },
    ],
    path: [
      "路由选项为字符串，写入 PipelineConfig 时转为 float。",
      "优先级：列 config.temperature > Provider 接入点默认值。",
      "对比本维时，ArenaRunRequest.temperature 全局覆盖被跳过，各列独立生效。",
      "多轮时温度在每轮 run 重新注入；高温度列的跨轮一致性通常更差。",
    ],
    langChain: "createColumnModel 按 config.temperature 构造模型。",
    langGraph: "与 LangChain 相同：模型在列装配时构造完成。",
    modules: ["packages/providers/provider-langchain/src/model-factory.ts", "packages/arena/arena-dimensions/src/router.ts", "packages/arena/arena-runner/src/runner.ts"],
    baselineTip: "对比框架/推理时常用 0 降低采样噪声；测创造性任务（如文案生成）可对比 0.7 vs 1.0。",
    caveats: [
      "Provider 原始温度会吸附到最近档位（0 / 0.3 / 0.7 / 1）作为默认基线。",
      "温度为 0 并不保证完全确定性：部分 Provider 仍有微小浮动或缓存差异。",
    ],
  },
  {
    id: "model",
    label: "模型",
    reality: "full",
    summary:
      "切换 LLM 接入点（跨厂不同 URL/Key，或同厂同连接不同 model）。解码参数（温度、Top P、思考强度等）由统一基线钉死，确保对比的是「模型能力」而非参数差异。",
    controls:
      "PipelineConfig.endpoint_id → ProviderLookup 端口解析接入点；经 createColumnModel 实例化。",
    options: [
      {
        value: "（默认）",
        label: "默认接入点",
        effect: "Provider.default_endpoint_id，选项中标记为「当前」。",
      },
      {
        value: "（其它）",
        label: "其它接入点",
        effect: "Settings 中配置的跨厂或同连接多 model 槽位。",
      },
    ],
    path: [
      "Provider 配置保存 endpoints → DimensionRouter.syncModelOptionsFromProvider（value=endpoint_id）。",
      "对比模型维时 temperature / top_p / max_output_tokens / thinking_level 等来自基线，各列相同。",
      "不足 2 个接入点时 meta.model_compare_ready=false，UI 禁用本维。",
      "多轮时各列模型一致接收相同 messages，差异体现在推理与工具调用质量。",
    ],
    langChain: "createColumnModel 经 ProviderLookup 端口解析连接与 model。",
    langGraph: "与 LangChain 相同：列装配时解析接入点。",
    modules: [
      "packages/contracts/contracts/src/provider.ts · LlmEndpoint / ProviderConfig.endpoints",
      "packages/arena/arena-dimensions/src/router.ts · syncModelOptionsFromProvider",
      "packages/providers/provider-langchain/src/model-factory.ts",
    ],
    baselineTip: "对比其它维时，接入点基线固定为默认接入点；对比本维时请在基线钉死温度与思考强度，避免隐性变量。",
    caveats: [
      "未在 Settings 登记的接入点不会出现在对比选项中。",
      "同一 base_url+api_format 下禁止重复 model id。",
      "未勾选「支持思考」的接入点在任意思考档位请求下都会落到 off。",
      "跨厂模型对比时，工具调用格式与上下文窗口差异可能干扰结论，建议固定任务模板。",
    ],
  },
  {
    id: "thinking",
    label: "思考强度",
    reality: "full",
    summary:
      "对比 off / low / medium / high 四档思考强度。模型须在 Settings 勾选「支持思考」；Anthropic 映射 budget_tokens，OpenAI 兼容映射 reasoning_effort。思考流与最终回答分轨展示。",
    controls:
      "PipelineConfig.thinking_level + endpoint.thinking_capable → createChatModel 注入思考参数。",
    options: [
      { value: "off", label: "关闭", effect: "不注入思考参数。" },
      { value: "low", label: "低", effect: "较小 budget / effort。" },
      { value: "medium", label: "中", effect: "默认中档。" },
      { value: "high", label: "高", effect: "更大 budget；可能抬高 max_tokens。" },
    ],
    path: [
      "Provider 配置：thinking_capable + thinking_level 写入 LlmEndpoint。",
      "DimensionRouter 按能力门控：incapable → 强制 off。",
      "providers/thinking 注入 Anthropic thinking 或 OpenAI reasoning_effort。",
      "SSE 以独立 thinking 事件流式回传，Trace 中与 thought 分开展示。",
    ],
    langChain: "createChatModel 按接入点能力注入思考字段。",
    langGraph: "与 LangChain 相同。",
    modules: [
      "packages/providers/provider-catalog/src/thinking.ts",
      "packages/providers/provider-langchain/src/model-factory.ts",
      "packages/contracts/contracts/src/provider-types.ts · effectiveThinkingLevel",
    ],
    baselineTip: "对比模型维时用基线统一思考档位；对比本维时钉住接入点与温度，观察思考预算对复杂推理任务的边际收益。",
    caveats: [
      "部分代理对 reasoning_effort / thinking 字段支持不一致，异常时检查 Provider 日志。",
      "思考流会作为独立 SSE thinking 事件，与最终回答分离；判分仅看最终答案。",
      "高档思考会显著增加 output_tokens 与耗时，多轮叠加时成本需纳入实验设计。",
    ],
  },
  {
    id: "thinking_budget",
    label: "思考预算",
    reality: "full",
    summary:
      "独立设置 Anthropic budget_tokens（思考 token 预算），与思考档位分开选用。数值优先于档位映射；0 表示跟随档位。仅 Anthropic Messages 端点可用。",
    controls:
      "PipelineConfig.thinking_budget + endpoint.thinking_budget_tokens/thinking_max_tokens → buildThinkingClientOptions 预算覆盖。",
    options: [
      { value: "0", label: "0（跟随档位）", effect: "按思考档位的固定预算映射。" },
      { value: "2048", label: "2048", effect: "budget_tokens=2048。" },
      { value: "8192", label: "8192", effect: "budget_tokens=8192。" },
      { value: "16384", label: "16384", effect: "budget_tokens=16384。" },
      { value: "32768", label: "32768", effect: "budget_tokens=32768。" },
      { value: "65536", label: "65536", effect: "budget_tokens=65536；基线可自由输入任意数值。" },
    ],
    path: [
      "Provider 配置：thinking_budget_tokens + thinking_max_tokens 写入 LlmEndpoint（输出必须大于思考）。",
      "Arena 运行级 thinking_budget > 0 时优先；否则用端点默认预算对。",
      "max_tokens 过小时自动抬升为 budget + 1024（Anthropic 协议要求 budget < max_tokens）。",
    ],
    langChain: "createChatModel 预算覆盖经 buildThinkingClientOptions 注入 thinking 块。",
    langGraph: "与 LangChain 相同。",
    modules: [
      "packages/providers/provider-catalog/src/thinking.ts",
      "packages/contracts/contracts/src/provider-types.ts",
      "packages/providers/provider-langchain/src/model-factory.ts",
    ],
    baselineTip: "对比预算维时钉住模型与档位；预算变化会同步抬高 max_tokens，注意成本与耗时随预算近似线性增长。",
    caveats: [
      "仅 Anthropic Messages 端点生效；非 Anthropic 端点该维不可选。",
      "部分网关对极大 budget_tokens 有上限或直接拒绝，异常时先查 Provider 日志。",
    ],
  },
  {
    id: "max_steps",
    label: "最大步数",
    reality: "full",
    summary:
      "限制 Agent 循环深度，防止无限循环并控制成本。Native、循环变体、OpenAI Agents SDK、Claude Agent SDK、LangGraph 与 Deep Agents 都有按 LLM 轮次计的业务预算；LangChain 无业务轮次预算，仅由底层 recursion_limit 近似约束。报告步骤数统一按 LLM 轮次口径展示。",
    controls:
      "Native、Plan-Execute、Self-Critique、AutoGen、OpenAI Agents SDK、Claude Agent SDK 按 LLM 轮次硬预算 max_steps（一次模型调用及其工具执行为一轮；Claude CLI 计 agentic 往返、OpenAI 计 SDK 轮次）；CrewAI 同样以 max_steps 为全局预算，并对每个 crew 任务另设轮次上限；LangGraph 与 Deep Agents 改为图预算 recursion_limit = max(50, max_steps×5)（实际轮数约 2.5×max_steps，5 步档由下限 50 主导、约 25 轮）；LangChain 无业务轮次预算，该 recursion_limit 是唯一上限。基线支持范围内任意整数，也可选 unlimited（-1 哨兵）取消轮次预算：Native 循环直到模型不再调工具或运行被中止，LangGraph 家族图以 200 000 图步为等效上限，两个 SDK 桥则不向 runner 传轮次上限。",
    options: [
      { value: "5", label: "5 步", effect: "更早结束循环。" },
      { value: "10", label: "10 步", effect: "默认。" },
      { value: "15", label: "15 步", effect: "更长工具链。" },
      { value: "20", label: "20 步", effect: "允许更深探索。" },
    ],
    path: [
      "LangGraph 初始 state 携带 config.max_steps。",
      "推理图节点在 step_count >= max_steps 时结束。",
      "recursion_limit = max(50, max_steps×5)：LangGraph 作安全网，LangChain 为唯一预算；Native 循环按同口径轮次预算收敛。unlimited 时 recursion_limit 固定 200 000、Native 不设轮次上限。",
      "步数用尽时 Agent 可能给出不完整答案，判分失败需结合 Trace 最后几步判断。",
    ],
    langChain: "主要约束底层图 recursion_limit（无独立业务 max_steps 状态）。",
    langGraph: "业务 max_steps + recursion_limit 双约束。",
    modules: [
      "packages/drivers/driver-langgraph/src/langgraph-driver.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
      "packages/drivers/driver-langgraph/src/reasoning-graphs.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
    ],
    baselineTip: "对比工具集时可用较小 max_steps（5）控制成本；复杂多步任务建议 15–20 并观察是否触顶。",
    caveats: [
      "LangChain 与 LangGraph 对「步」的计数语义不完全等同，跨框架对比请逐步核对 Trace。",
      "多轮追问时每轮独立计步，前一轮的工具调用不计入本轮 max_steps。",
    ],
  },
  {
    id: "toolset",
    label: "工具集",
    reality: "full",
    summary:
      "过滤真实绑定到模型的工具列表（非文案提示）。决定 Agent 能调用哪些 Tool schema，直接影响可完成的任务类型与误调用风险。",
    controls:
      "config.toolset → selectToolNames 过滤绑定工具集（toLangchainTools）；每列装配时确定，无跨列共享状态。",
    options: toolsetTable.map((t) => ({
      value: t.id,
      label: t.label,
      effect: t.tools,
    })),
    path: [
      "列装配时按 config.toolset 过滤工具面（tools/toolset）。",
      "LangGraph：图内工具绑定与工具节点使用同一过滤集。",
      "LangChain：create_agent 只绑定过滤后的工具。",
      "每列工具面独立构造，列间天然隔离。",
      "多轮时磁盘工作区跨轮保留，read_only 与 edit_run 在多轮文件任务中差异显著。",
    ],
    langChain: "create_agent 只看到过滤后的工具 schema。",
    langGraph: "bind_tools 与执行查找同一活动集。",
    modules: [
      "packages/tools/tool-registry/src/toolset.ts",
      "packages/agent/agent/src/agent-execution.ts",
      "packages/harness/harness/src/control/tool-guard.ts",
    ],
    baselineTip: "测 coding 任务时基线用 full 或 edit_run；框架维对比时 toolset 被统一为 full。",
    caveats: [
      "模型仍可能「口述」未绑定工具；实际调用会因未绑定而失败或走未知工具分支。",
      "tool_guard 与 toolset 是两层独立机制：前者拦截跑题调用，后者限制可用集合。",
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    reality: "full",
    summary:
      "把进程内 MCP 能力服务器（文件系统、抓取）桥入列工具表，检验 MCP 附加工具相对纯内置是否改变 agent 产出。",
    controls:
      "config.mcp_policy 选择挂载：off 不挂载；fs 桥文件系统服务器；full 再加抓取服务器（抓取仅进 full toolset）。",
    options: [
      {
        value: "off",
        label: "MCP 关闭（仅内置）",
        effect: "无 MCP 工具；模型只用 toolset 过滤后的内置工具。",
      },
      {
        value: "fs",
        label: "MCP 文件系统服务器",
        effect: "增加 mcp__fs_list / mcp__fs_read，三 toolset 全挂载。",
      },
      {
        value: "full",
        label: "MCP 文件系统 + 抓取",
        effect: "文件系统服务器 + mcp__fetch_url（仅 full toolset）。",
      },
    ],
    path: [
      "Agent 装配在 toolset 过滤后注册 MCP 工具；显式 tool 名单保持权威，永不附带 MCP。",
      "ablation 行按列报告 mcp_share，MCP 用量与判分增减直接可读。",
      "系统提示词用 MCP 行显式 grounding 挂载情况。",
    ],
    langChain: "MCP 工具走同一注册表桥，与内置无异；create_agent 视为普通工具。",
    langGraph: "同一桥：图工具节点经共享注册表执行 MCP 工具。",
    modules: [
      "packages/tools/tool-mcp/src/servers.ts",
      "packages/tools/tool-mcp/src/bridge.ts",
      "packages/agent/agent/src/agent-execution.ts",
    ],
    baselineTip: "先在文件列举任务上对比 off vs fs；任务确需抓取时再加 full。",
    caveats: [
      "MCP 服务器为进程内实现，直连列工作区：无 socket、无外部进程。",
      "Trace 中的 mcp__ 前缀精确标记哪些调用走了 MCP 桥。",
    ],
  },
  {
    id: "skill",
    label: "Skill",
    reality: "full",
    summary:
      "控制专家 runbook 如何到达模型：禁用、经 skill 工具按需加载、或预注入提示词；检验 skill 加载是否改变输出。",
    controls:
      "config.skill_policy 门控 skill 工具（off 摘除），preloaded 时把内嵌 runbook 块注入 system prompt。",
    options: [
      {
        value: "off",
        label: "Skill 禁用",
        effect: "摘除 skill 工具；模型只用基础提示词工作。",
      },
      {
        value: "on_demand",
        label: "按需经 skill 工具加载",
        effect: "模型先 list 再 read 命中的 runbook 后行动。",
      },
      {
        value: "preloaded",
        label: "预注入提示词",
        effect: "内嵌 runbook 随 system prompt 下发；skill 工具保留给工作区覆盖。",
      },
    ],
    path: [
      "内嵌 runbook 为嵌入常量；工作区 .skills/<name>/SKILL.md 同名覆盖内嵌。",
      "预注入经执行上下文下发，三驱动经 buildSystemUser 继承。",
      "ablation 行按列报告 skill_reads，对照判分增减。",
    ],
    langChain: "同一 skill 工具与预注入块，无 LC 专属路径。",
    langGraph: "同一 skill 工具与预注入块，无图专属路径。",
    modules: [
      "packages/tools/tool-builtins/src/definitions/skills.ts",
      "packages/tools/tool-builtins/src/definitions/skill.ts",
      "packages/harness/harness/src/prompt/assembly.ts",
    ],
    baselineTip: "在约定类任务（如 commit 格式）上对比 off vs preloaded，runbook 知识最具决定性。",
    caveats: [
      "除 preloaded 外 skill 永不自动注入；on_demand 为省上下文而设计。",
      "坏格式工作区 skill 跳过并大声计数，永不静默。",
    ],
  },
  {
    id: "orchestration",
    label: "编排",
    reality: "full",
    summary:
      "选择执行纪律：自由 direct、动手前写计划的 plan-first、显式跟踪目标的 goal-first；检验计划与目标纪律如何改变任务完成度。",
    controls:
      "config.orchestration 在新鲜工作区预置 plan 文档（plan_first）或 goal 文档（goal_first），并追加对应纪律行到 system prompt。",
    options: [
      {
        value: "direct",
        label: "直接执行",
        effect: "无预置、无纪律行；模型自由执行。",
      },
      {
        value: "plan_first",
        label: "计划优先",
        effect: "预置 .agent-plan.md，要求先经 plan 工具 propose 再动手。",
      },
      {
        value: "goal_first",
        label: "目标优先",
        effect: "预置 .agent-goal.json，要求先 set 目标与完成标准。",
      },
    ],
    path: [
      "预置只发生在新鲜工作区；追问轮复用 agent 已写的 plan/goal。",
      "预置失败不影响其要纪律的执行；提示词纪律行依然生效。",
      "plan/goal 工件落盘，随报告 artifacts 页带出。",
    ],
    langChain: "同一种子与提示词行；纪律与框架无关。",
    langGraph: "同一种子与提示词行；纪律与框架无关。",
    modules: [
      "packages/agent/agent/src/agent-execution.ts",
      "packages/tools/tool-builtins/src/definitions/plan.ts",
      "packages/tools/tool-builtins/src/definitions/goal.ts",
    ],
    baselineTip: "在双工件杂务上对比三者，看 artifacts + ablation delegations，而不只看 DONE 标记。",
    caveats: [
      "无人工审批门：propose 只记录不呈批（durable 半，无审批半）。",
      "blocked 的 goal 必须写理由：无理由阻塞会被拒绝。",
    ],
  },
  {
    id: "memory",
    label: "记忆",
    reality: "full",
    summary:
      "跨会话记忆挂载：episodic 挂历史任务复盘（成败与教训），semantic 挂项目事实与约定；检验「带着过往经验做题」能否降低步骤数与 Token 成本。",
    controls:
      "config.memory 决定顶层运行的挂载量：recall 命中后经 renderMemoryBlock 以 [Prior Experience & Relevant Memories] 段落写入 system prompt；每次顶层运行结束后蒸馏一条 episodic 复盘回写（成功与失败路径都会结算）。",
    options: [
      {
        value: "none",
        label: "无记忆",
        effect: "不挂载也不回写；每次运行都是无状态的第一题。",
      },
      {
        value: "episodic",
        label: "历史经验",
        effect: "按任务检索至多 3 条过往复盘挂载为经验行；结束后回写本次复盘。",
      },
      {
        value: "semantic",
        label: "项目事实",
        effect: "按查询检索至多 5 条项目事实/约定挂载；不回写经验。",
      },
      {
        value: "full",
        label: "全量",
        effect: "episodic + semantic 同时挂载（3 + 5 条上限）；结束后回写 episodic 复盘。",
      },
    ],
    path: [
      "仅顶层运行挂载：subagent 嵌套轮共享文件但不重复 recall，父列已携带记忆。",
      "recall 与回写都是 best-effort：服务缺失或抛错时告警并按无状态继续，绝不拖垮运行。",
      "未知档位 fail closed 到无状态；经验行由 keyActions（≤12 个工具名）与 ≤500 字任务摘要合成，prompt 段每行截断 300 字符。",
    ],
    langChain: "同一段挂载与回写逻辑；记忆与框架无关。",
    langGraph: "同一段挂载与回写逻辑；记忆与框架无关。",
    modules: [
      "packages/agent/agent/src/agent-execution.ts · recallMemoryForRun / recordEpisodicExperience",
      "packages/harness/harness/src/prompt/assembly.ts · renderMemoryBlock",
      "packages/contracts/contracts/src/memory-port.ts · MemoryServicePort",
      "packages/memory/memory-service/src/memory-service-adapter.ts · MemoryServiceAdapter",
    ],
    baselineTip: "同一任务跑两轮对比 none 与 full，看第二轮步骤数 / Token 是否下降；召回质量取决于此前是否记录过相似任务。",
    caveats: [
      "存储持久化在 data/memory_episodic.json 与 data/memory_semantic.json；存储缺失或失败时该次运行按无状态降级（best-effort），不会导致运行失败。",
      "Builder 固定 memory=none；记忆只作为 Arena 对比维存在。",
      "回写按运行粒度蒸馏（任务、工具、成败、教训），不含中间轨迹全文。",
    ],
  },
  {
    id: "history_mode",
    label: "历史",
    reality: "full",
    summary:
      "跨轮历史回放模式：捕获每次运行的工具调用（action→observation 配对），下一轮按列的档位渲染回 assistant 历史文本；检验「模型看见上一轮过程」对追问与纠错的影响。",
    controls:
      "捕获端始终存全量转写超集（tool_rounds；超长参数保留 2000 字 preview，与结果 8000 字截断同理），渲染端在执行边界按 config.history_mode 裁剪：minimal 仅裸问答对；tool_summary 在答案后附每次调用一行摘要；full 把上一轮展开为结构化消息（assistant(tool_calls 参数详情) → tool 结果 → 最终回复）。",
    options: [
      {
        value: "minimal",
        label: "极简",
        effect: "只回放裸问答对；工具过程不跨轮（历史行为，默认）。",
      },
      {
        value: "tool_summary",
        label: "工具摘要",
        effect: "上一轮每次工具调用在答案后附一行「工具(参数) → 结果摘要」。",
      },
      {
        value: "full",
        label: "全量",
        effect: "上一轮展开为结构化消息：assistant 带工具调用参数（tool_calls）→ tool 结果 → 最终回复（单轮总量 32k 字符封顶）。",
      },
    ],
    path: [
      "捕获走事件流重建（extractToolRounds 按 pipeline 列配对 action/observation），不改 AgentDriver 契约；观察结果保真上限 = UI 显示的 8000 字截断。",
      "full 的结构化展开只发生在执行边界：存储与 wire 仍是 user/assistant + tool_rounds 形态，严格交替校验不变；tool_summary 保持答案附录文本，报文/日志里以答案内容形式可见。",
      "线程、Arena 列会话、builder 会话三条链路共享同一存储与渲染语义；fork 子代理继承父列渲染后的历史。",
    ],
    langChain: "历史在执行边界统一渲染后才进各框架，五个 driver 无差别。",
    langGraph: "历史在执行边界统一渲染后才进各框架，五个 driver 无差别。",
    modules: [
      "packages/contracts/contracts/src/history-mode.ts · extractToolRounds / renderToolActivity",
      "packages/agent/agent/src/history-render.ts · renderHistoryForMode（执行边界）",
      "packages/application/application/src/thread-store.ts · appendTurn（线程捕获）",
      "apps/web/src/app/arena/useColumnSessions.ts · pushColumnTurn（客户端捕获）",
    ],
    baselineTip: "同题两轮：第一轮让模型跑工具，第二轮追问「刚才第一步做了什么」，对比 minimal（答不上）与 tool_summary/full（能引用）的差异。",
    caveats: [
      "tool_rounds 捕获在运行成功后提交；失败轮不落盘，与转写本的原子提交语义一致。",
      "full 模式的工具结果是事件流回放，不等于模型当时真实看到的全文（超长结果已被截断）。",
      "切换档位不丢数据：存储始终是全量超集，下一轮按当前列档位重新渲染。",
    ],
  },
];

const HONESTY: Array<{ title: string; body: string }> = [
  {
    title: "多轮对话",
    body: "messages 各列共享、不随对比维变化；turn 是 SSE 展示元数据而非 PipelineConfig 字段。按轮对比 Trace / 报告时，请确认每轮基线与对比维一致。",
  },
  {
    title: "推理 × LangChain",
    body: "推理维对比强制 native；LangChain 列仅在框架维出现，且统一 react + full 工具面。",
  },
  {
    title: "多接入点",
    body: "Arena「模型」维切换 Settings 中的 LLM 接入点（跨厂 URL/Key 或同连接多 model）。温度 / Top P / 思考强度等由统一基线钉死。不足 2 个接入点无法对比。",
  },
  {
    title: "思考能力门控",
    body: "未在 Settings 勾选「支持思考」的模型，无论基线或对比维选了哪一档，都会强制 off；思考流以独立 SSE thinking 事件展示。",
  },
  {
    title: "上下文提示文案",
    body: "除 prepareMessagesForLlm 真实裁剪外，还有策略说明文案叠加。",
  },
  {
    title: "Harness 双通道",
    body: "控制循环真实重试；同时 Prompt 组装会追加 Harness 段文案。",
  },
  {
    title: "prompt_version",
    body: "PipelineConfig 保留字段，当前执行路径不读取，不能作为对比维。",
  },
  {
    title: "工具护栏",
    body: "tool_guard 可拦截跑题 tool_calls；与 toolset 过滤是两层独立机制。",
  },
];

/** Overview and boundaries sections: ids serve the TOC, hero quick links, and anchors simultaneously (single source; never duplicate in the view). */
const overviewSections: GuideSection[] = [
  {
    id: "method",
    title: "控制变量法",
    group: "overview",
    lead:
      "一次实验只让**一个字段**在各列之间变化（对比维），其余字段取同一套基线。对比报告里的耗时、Token、工具次数、判分，才能归因到正在测量的那一维。",
    blocks: [
      {
        kind: "formula",
        cards: [
          { tag: "对比维", text: "列间变化", code: "selections[] → field" },
          { tag: "基线", text: "列间固定", code: "baseline → 其它字段" },
          { tag: "输出", text: "多列 PipelineConfig", code: "Adapter.run × N" },
        ],
        operators: ["+", "→"],
      },
      {
        kind: "note",
        text: "路由：`DimensionRouter.route(dimension, selections, baseline)` · 映射：`DIMENSION_FIELD`",
      },
    ],
  },
  {
    id: "multi-turn",
    title: "多轮对话与按轮对比",
    group: "overview",
    lead: MULTI_TURN_DOC.summary,
    blocks: [
      { kind: "steps", heading: "运行机制", items: MULTI_TURN_DOC.mechanics },
      { kind: "bullets", heading: "约束与边界", items: MULTI_TURN_DOC.limits },
      { kind: "cards", items: COMPARE_FORMS },
      { kind: "codeList", heading: "代码入口", items: MULTI_TURN_DOC.modules },
    ],
  },
  {
    id: "field-matrix",
    title: "字段总表",
    group: "overview",
    lead:
      "十四个对比维与 `PipelineConfig` 字段一一对应；也可全部出现在基线面板中。多轮历史走 `ArenaRunRequest.messages`，不属于对比维。",
    blocks: [{ kind: "fieldMatrix" }],
  },
  {
    id: "baseline",
    title: "基线机制",
    group: "overview",
    lead: "基线是对非对比维字段的覆盖写入。前端锁定与后端校验必须一致，非法取值直接失败。",
    blocks: [
      { kind: "cards", items: BASELINE_RULES },
      { kind: "note", text: "`BaselineOverrides` → `resolveBaselineOverrides` → `buildPipelineBase`" },
    ],
  },
  {
    id: "pipeline",
    title: "单次运行链路",
    group: "overview",
    blocks: [{ kind: "stages", items: PIPELINE_STAGES }],
  },
  {
    id: "toolsets",
    title: "工具集明细",
    group: "overview",
    lead: "`toolset` 经 `selectToolNames` 过滤后真实 `bind_tools` / `create_agent`——以绑定集合为准。",
    blocks: [{ kind: "toolsetGrid" }],
  },
  {
    id: "honesty",
    title: "诚实边界",
    group: "boundary",
    lead: "刻意不夸大，避免把「文案差异」误读成「编排差异」。",
    blocks: [{ kind: "cards", items: HONESTY }],
  },
];

/** Page hero copy and config (metric counts derive from this module's content arrays; numbers are never handwritten). */
const hero: GuideHero = {
  eyebrow: "OPTICAL BENCH · REFERENCE",
  title: "维度与基线说明",
  lead: "控制变量法的结构化参考：字段如何映射、基线如何锁定、十四对比维在各框架上是否真实生效，以及多轮对话如何按轮次分段对比。",
  actions: [
    { href: "/arena", label: "打开 Arena", icon: "flask", variant: "primary" },
    { href: "/learn", label: "学习路径", icon: "arrow", variant: "ghost" },
  ],
  pillars: [
    { kicker: "管线", text: "解码 · 接入点分层对照" },
    { kicker: "基线", text: "锁定当前对比维以外的字段" },
    { kicker: "多轮", text: "共享 messages，按 turn 分段" },
    { kicker: "Trace", text: "列对齐对比 Thought / Action" },
  ],
  metrics: [
    { label: "对比维度", count: dimensions.length },
    { label: "字段映射", count: fieldMatrix.length },
    { label: "工具集预设", count: toolsetTable.length },
  ],
  dimChipLimit: 6,
};

/** Copy of the dimension-details index area. */
const dimIndexDoc = {
  eyebrow: "对比维度详情",
  note: "统一结构：控制什么 → 选项 → 路径 → 框架细节 → 代码 → 基线建议 → 边界",
};

type TocGroupId = "overview" | "dimensions" | "boundary";

const TOC_GROUP_ORDER: readonly TocGroupId[] = ["overview", "dimensions", "boundary"];

const TOC_GROUP_TITLES: Record<TocGroupId, string> = {
  overview: "总览",
  dimensions: "对比维度",
  boundary: "边界",
};

/** The TOC derives from the section and dimension arrays, keeping anchor ids single-sourced and never out of sync with the rendered sections. */
const tocGroups: Array<{
  title: string;
  items: Array<{ id: string; label: string }>;
}> = TOC_GROUP_ORDER.map((group) => ({
  title: TOC_GROUP_TITLES[group],
  items:
    group === "dimensions"
      ? dimensions.map((d) => ({ id: d.id, label: d.label }))
      : overviewSections.filter((s) => s.group === group).map((s) => ({
          id: s.id,
          label: s.title,
        })),
}));

/** Badge copy per reality level. */
const realityLabel: Record<Reality, string> = {
  full: "真实生效",
  partial: "框架相关",
  "prompt-only": "主要改 Prompt",
};

/** The single guide content object for zh-CN; its inferred type is the GuideContent contract. */
export const guideContent = {
  realityLabel,
  fieldMatrix,
  toolsetTable,
  dimensions,
  overviewSections,
  hero,
  dimIndexDoc,
  tocGroups,
};
export type GuideContent = typeof guideContent;

if (process.env.NODE_ENV !== "production") {
  // Content drift guard (dev only): duplicated section ids would let anchors/TOC silently overwrite each other.
  const ids = [...overviewSections.map((s) => s.id), ...dimensions.map((d) => d.id)];
  const duplicated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicated.length > 0) {
    throw new Error(`Duplicate guide section ids: ${duplicated.join(", ")}`);
  }
  for (const section of overviewSections) {
    for (const block of section.blocks) {
      if (block.kind === "formula" && block.operators.length !== block.cards.length - 1) {
        throw new Error(
          `Section "${section.id}" formula block: operators length must be cards - 1`,
        );
      }
    }
  }
  // When the contract gains a dimension not registered in this content, fail at dev time instead of silently missing a block on the page.
  const missingDims = DIMENSION_IDS.filter(
    (id) => !dimensions.some((d) => d.id === id) || !fieldMatrix.some((row) => row.dimension === id),
  );
  if (missingDims.length > 0) {
    throw new Error(
      `Dimension(s) missing from guide content (DIMENSIONS or FIELD_MATRIX): ${missingDims.join(", ")}`,
    );
  }
  const matrixIds = fieldMatrix.map((row) => row.dimension);
  const duplicatedMatrixIds = [
    ...new Set(matrixIds.filter((id, index) => matrixIds.indexOf(id) !== index)),
  ];
  if (duplicatedMatrixIds.length > 0) {
    throw new Error(`Duplicate FIELD_MATRIX dimension rows: ${duplicatedMatrixIds.join(", ")}`);
  }
}
