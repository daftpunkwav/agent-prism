/** 维度说明页的结构化文档数据（与后端 DIMENSION_FIELD / 执行路径对齐）。 */

export type Reality = "full" | "partial" | "prompt-only";

export type DimOption = {
  value: string;
  label: string;
  effect: string;
};

export type DimDoc = {
  id: string;
  label: string;
  field: string;
  reality: Reality;
  summary: string;
  controls: string;
  options: DimOption[];
  path: string[];
  lc: string;
  lg: string;
  modules: string[];
  baselineTip: string;
  caveats: string[];
};

export const REALITY_LABEL: Record<Reality, string> = {
  full: "真实生效",
  partial: "框架相关",
  "prompt-only": "主要改 Prompt",
};

export const FIELD_MATRIX: Array<{
  dimension: string;
  field: string;
  type: string;
  defaultValue: string;
  lockedWhen: string;
}> = [
  {
    dimension: "framework",
    field: "framework",
    type: "string",
    defaultValue: "langgraph",
    lockedWhen: "对比「框架」时",
  },
  {
    dimension: "prompt",
    field: "prompt_profile",
    type: "PromptProfile",
    defaultValue: "zero_shot",
    lockedWhen: "对比「提示词」时",
  },
  {
    dimension: "reasoning",
    field: "reasoning",
    type: "ReasoningMode",
    defaultValue: "react",
    lockedWhen: "对比「推理模式」时",
  },
  {
    dimension: "context",
    field: "context",
    type: "ContextStrategy",
    defaultValue: "sliding",
    lockedWhen: "对比「上下文」时",
  },
  {
    dimension: "harness",
    field: "harness",
    type: "HarnessLevel",
    defaultValue: "bare",
    lockedWhen: "对比「Harness」时",
  },
  {
    dimension: "temperature",
    field: "temperature",
    type: "float 0–2",
    defaultValue: "来自 Provider（吸附到 0 / 0.3 / 0.7 / 1）",
    lockedWhen: "对比「温度」时",
  },
  {
    dimension: "model",
    field: "endpoint_id",
    type: "string",
    defaultValue: "Provider.default_endpoint_id",
    lockedWhen: "对比「模型」时",
  },
  {
    dimension: "thinking",
    field: "thinking_level",
    type: "ThinkingLevel",
    defaultValue: "接入点默认（不支持则 off）",
    lockedWhen: "对比「思考强度」时",
  },
  {
    dimension: "max_steps",
    field: "max_steps",
    type: "int 1–40",
    defaultValue: "10",
    lockedWhen: "对比「最大步数」时",
  },
  {
    dimension: "toolset",
    field: "toolset",
    type: "ToolsetId",
    defaultValue: "full",
    lockedWhen: "对比「工具集」时",
  },
];

export const PIPELINE_STAGES: Array<{
  title: string;
  detail: string;
  module: string;
}> = [
  {
    title: "请求入场",
    detail:
      "前端 POST /api/arena/run，携带 dimension、selections、baseline。服务端用 Semaphore 限制并发。",
    module: "api/arena.py · runner.RunnerPool",
  },
  {
    title: "路由展开",
    detail:
      "DimensionRouter.route 为每个选中子项生成 PipelineConfig；基线覆盖写入非对比维；对比维字段被忽略。",
    module: "arena/router.py",
  },
  {
    title: "并行 Worker",
    detail:
      "每列一个 asyncio Task；按 config.framework 取 Adapter；异常收敛为 SSE error，不拖垮其它列。",
    module: "arena/runner.py",
  },
  {
    title: "工作空间",
    detail:
      "每列独占 workspace 名（label + 时间戳 + uuid）；ContextVar 隔离文件工具读写。",
    module: "adapters/_common_run · arena/workspace.py",
  },
  {
    title: "begin_pipeline",
    detail:
      "写入 LLM overrides（temperature、model）；set_active_toolset；build_messages 叠 Prompt / 推理 / Harness / 上下文提示。",
    module: "adapters/_common_run.begin_pipeline",
  },
  {
    title: "编排执行",
    detail:
      "LangChain：create_agent + 中间件；LangGraph：编译推理图。二者均可包在 HarnessRunner 外层。",
    module: "adapters/*_adapter.py · harness.py",
  },
  {
    title: "流式回传",
    detail:
      "astream_events → thought / action / observation / token_update / complete；前端 Trace 渲染。",
    module: "adapters/_common_run.emit_*",
  },
  {
    title: "清理",
    detail:
      "clear_pipeline_llm_overrides、clear_active_toolset、clear_current_workspace，避免串列。",
    module: "各 Adapter finally",
  },
];

export const BASELINE_RULES: Array<{ title: string; body: string }> = [
  {
    title: "UI 锁定",
    body: "当前对比维对应的基线下拉 disabled；收起摘要按管线 / 解码 / 接入点分组列出基线。",
  },
  {
    title: "后端忽略",
    body: "_resolve_baseline_overrides 跳过 DIMENSION_FIELD[dimension]，即使请求体带了该字段也不生效。",
  },
  {
    title: "取值校验",
    body: "覆盖值必须落在该维 DIMENSION_OPTIONS 的 value 集合内，否则 ValueError，无静默回退。",
  },
  {
    title: "类型归一",
    body: "temperature / max_steps 从选项字符串转为 float / int 再写入 PipelineConfig。",
  },
  {
    title: "与 Provider 关系",
    body: "未覆盖时 model_id、temperature 默认来自 Settings 持久化配置；对比温度维时请求级全局 temperature 不会抹平各列。",
  },
];

export const TOOLSET_TABLE: Array<{
  id: string;
  label: string;
  tools: string;
}> = [
  {
    id: "full",
    label: "全工具",
    tools:
      "get_current_time, calculate, write/append/create/read/list/tree/delete_file, run_code, summarize_text（共 11）",
  },
  {
    id: "code_file",
    label: "代码+文件",
    tools:
      "run_code, calculate, write_file, append_file, create_file, read_file, list_files, file_tree, delete_file",
  },
  {
    id: "calc_time",
    label: "计算+时间",
    tools: "calculate, get_current_time",
  },
  {
    id: "workspace_read",
    label: "只读工作区",
    tools: "read_file, list_files, file_tree, summarize_text, get_current_time",
  },
];

export const DIMENSIONS: DimDoc[] = [
  {
    id: "framework",
    label: "框架",
    field: "framework",
    reality: "full",
    summary: "切换 Agent 编排运行时：同一问题、同一基线，比较 LangChain 与 LangGraph 的行为差异。",
    controls: "决定走哪一个 FrameworkAdapter.run。",
    options: [
      {
        value: "langchain",
        label: "LangChain",
        effect: "create_agent + Tool Calling；上下文中间件 + 工具护栏。",
      },
      {
        value: "langgraph",
        label: "LangGraph",
        effect: "按 reasoning 编译不同 StateGraph；max_steps 约束业务循环。",
      },
    ],
    path: [
      "RunnerPool 按 config.framework 从 FrameworkAdapterRegistry 取 Adapter。",
      "选项由 sync_framework_options_from_registry 与已注册 Adapter 同步。",
      "reserved 框架访问会抛 AdapterReservedError。",
    ],
    lc: "LangChainAdapter：create_agent(llm, tools, system_prompt, middleware)。",
    lg: "LangGraphAdapter：REASONING_MODES[reasoning].graph_builder().compile()。",
    modules: [
      "backend/app/adapters/base.py",
      "backend/app/adapters/langchain_adapter.py",
      "backend/app/adapters/langgraph_adapter.py",
      "backend/app/arena/runner.py",
      "backend/app/arena/router.sync_framework_options_from_registry",
    ],
    baselineTip: "测 Prompt / 上下文 / Harness 时常用 langgraph 作框架基线。",
    caveats: ["新增框架需实现 FrameworkAdapter 并 register，才会出现在维度选项中。"],
  },
  {
    id: "prompt",
    label: "提示词",
    field: "prompt_profile",
    reality: "full",
    summary: "只切换 Prompt 模板层（system / user_suffix），不改图结构或工具绑定。",
    controls: "build_messages 的 profile 参数 → PROFILES[profile]。",
    options: [
      {
        value: "zero_shot",
        label: "Zero-shot",
        effect: "基础 system；无示例后缀。",
      },
      {
        value: "few_shot",
        label: "Few-shot",
        effect: "user 附加时间/计算示例轨迹。",
      },
      {
        value: "cot_prompt",
        label: "CoT Prompt",
        effect: "system 要求逐步 Thought；user 加 Let’s think step by step。",
      },
      {
        value: "structured",
        label: "Structured",
        effect: "最终回答必须是 JSON：reasoning / answer / tools_used。",
      },
    ],
    path: [
      "begin_pipeline → build_messages(question, prompt_profile, reasoning, harness, context)。",
      "先取 PROFILES，再叠加 apply_reasoning_mode、apply_harness_level、上下文 hint。",
      "因此「提示词维」变化的是 profile 段；其它叠加段由基线决定。",
    ],
    lc: "与 LangGraph 相同：都经 build_messages；差异不在框架侧。",
    lg: "同上。",
    modules: ["backend/app/arena/prompts.py", "backend/app/adapters/_common_run.py"],
    baselineTip: "对比框架时可用 structured 检验格式遵从是否因编排而不同。",
    caveats: [
      "「CoT Prompt」≠ 推理维的 CoT+Tool：前者只改文案，后者改 LangGraph 节点。",
    ],
  },
  {
    id: "reasoning",
    label: "推理模式",
    field: "reasoning",
    reality: "partial",
    summary: "控制思考与调工具的编排策略；LangGraph 换图，LangChain 主要换 Prompt。",
    controls: "Prompt 后缀 +（仅 LangGraph）graph_builder 选择。",
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
        effect: "生成多候选 → 评估选择 → 执行。",
      },
      {
        value: "reflexion",
        label: "Reflexion",
        effect: "execute ↔ tools → reflect；可按反思再进入执行。",
      },
    ],
    path: [
      "两侧：apply_reasoning_mode 追加 REASONING_MODES[mode] 的 system/user 后缀。",
      "LangGraph：spec.graph_builder 编译不同节点图。",
      "LangChain：create_agent 骨架固定；开场 thought 标注「推理=仅 Prompt」。",
    ],
    lc: "图不切换；差异来自 Prompt 后缀与模型行为。",
    lg: "真实切换 ReAct / CoT+Tool / ToT / Reflexion 图结构。",
    modules: [
      "backend/app/arena/reasoning_graph.py",
      "backend/app/arena/reasoning.py",
      "backend/app/adapters/langgraph_adapter.py",
      "backend/app/adapters/langchain_adapter.py",
    ],
    baselineTip: "对比本维时，框架基线请保持 langgraph，否则看不到图结构差异。",
    caveats: ["reality=partial：结果解读必须标明框架基线。"],
  },
  {
    id: "context",
    label: "上下文",
    field: "context",
    reality: "full",
    summary: "每次 LLM 调用前如何裁剪、摘要或检索补充消息历史。",
    controls: "prepare_messages_for_llm(strategy) + Prompt 层 _CONTEXT_HINTS。",
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
    ],
    path: [
      "build_messages 注入策略说明文案。",
      "LangChain：_ArenaContextMiddleware 每次模型调用前裁剪。",
      "LangGraph：state.context_strategy → _llm_messages → prepare_messages_for_llm。",
      "sanitize 会合并/压平非前缀 SystemMessage，兼容 Anthropic。",
    ],
    lc: "中间件真实裁剪；与策略文案叠加。",
    lg: "图内每次 LLM 调用真实裁剪。",
    modules: [
      "backend/app/arena/context_manager.py",
      "backend/app/arena/message_sanitize.py",
      "backend/app/arena/rag.py",
      "backend/app/adapters/langchain_adapter.py",
    ],
    baselineTip: "长工具链任务更适合测 summary / vector / hybrid。",
    caveats: ["vector 依赖当前工作区已有文件；空工作区时检索为空。"],
  },
  {
    id: "harness",
    label: "Harness",
    field: "harness",
    reality: "full",
    summary: "在编排外层增加验证 / 反思 / 自进化控制循环。",
    controls: "HarnessRunner(level) + apply_harness_level Prompt 后缀。",
    options: [
      {
        value: "bare",
        label: "裸运行",
        effect: "单次 astream_events，无验证重试。",
      },
      {
        value: "verify",
        label: "验证循环",
        effect: "结束后 verify_result；失败可原样重跑（最多 2 次含首次）。",
      },
      {
        value: "reflect",
        label: "反思循环",
        effect: "失败后 reflect_on_failure，把反思注入再试。",
      },
      {
        value: "self_evolve",
        label: "自进化",
        effect: "失败后 propose_harness_edit（经注入清洗），修改后再试。",
      },
    ],
    path: [
      "Adapter 用 HarnessRunner.stream_events 包装 graph/agent。",
      "非 bare：提取答案 → verify → 可选 reflect/edit → 重建 messages。",
      "SSE 可出现 verify / reflect / harness_edit 事件。",
    ],
    lc: "对 create_agent 图同样包一层 HarnessRunner。",
    lg: "对编译后的推理图包一层 HarnessRunner。",
    modules: ["backend/app/arena/harness.py", "backend/app/adapters/*_adapter.py"],
    baselineTip: "测 Prompt 改进是否「真有效」时，常用 verify 作基线或对比维。",
    caveats: ["自进化的 prompt 增补有长度与注入清洗；不会执行任意代码。"],
  },
  {
    id: "temperature",
    label: "温度",
    field: "temperature",
    reality: "full",
    summary: "LLM 采样温度，直接影响输出随机性。",
    controls: "set_pipeline_llm_overrides(temperature=…) / create_chat_model(temperature=…)。",
    options: [
      { value: "0", label: "0", effect: "偏确定性。" },
      { value: "0.3", label: "0.3", effect: "轻度随机。" },
      { value: "0.7", label: "0.7", effect: "中等探索。" },
      { value: "1", label: "1.0", effect: "更高随机。" },
    ],
    path: [
      "路由选项为字符串，写入 PipelineConfig 时转为 float。",
      "优先级：显式参数 > ContextVar overrides > ProviderConfig。",
      "对比本维时，ArenaRunRequest.temperature 全局覆盖被跳过。",
    ],
    lc: "create_chat_model(temperature=config.temperature)。",
    lg: "图内 create_chat_model 读 ContextVar overrides。",
    modules: ["backend/app/arena/llm.py", "backend/app/arena/router.py", "backend/app/arena/runner.py"],
    baselineTip: "对比框架/推理时常用 0 降低采样噪声。",
    caveats: ["Provider 原始温度会吸附到最近档位作为默认基线。"],
  },
  {
    id: "model",
    label: "模型",
    field: "endpoint_id",
    reality: "full",
    summary: "切换 LLM 接入点（跨厂不同 URL/Key，或同厂同连接不同 model）。解码参数由统一基线钉死。",
    controls: "PipelineConfig.endpoint_id → ContextVar 连接覆盖 + model。",
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
      "Settings 保存 endpoints → sync_model_options_from_provider（value=endpoint_id）。",
      "对比模型维时 temperature / top_p / max_output_tokens 等来自基线，各列相同。",
      "不足 2 个接入点时 meta.model_compare_ready=false。",
    ],
    lc: "create_chat_model 读 ContextVar 连接与 model。",
    lg: "经 begin_pipeline 注入完整 overrides。",
    modules: [
      "backend/app/config.LlmEndpoint / ProviderConfig.endpoints",
      "backend/app/arena/router.sync_model_options_from_provider",
      "backend/app/arena/llm.py",
    ],
    baselineTip: "对比其它维时，接入点基线固定为默认接入点；Top P / 思考强度等可在基线单独钉死。",
    caveats: [
      "未在 Settings 登记的接入点不会出现在对比选项中。",
      "同一 base_url+api_format 下禁止重复 model id。",
      "未勾选「支持思考」的接入点在任意思考档位请求下都会落到 off。",
    ],
  },
  {
    id: "thinking",
    label: "思考强度",
    field: "thinking_level",
    reality: "full",
    summary:
      "对比 off / low / medium / high。模型须在 Settings 勾选「支持思考」；Anthropic 映射 budget_tokens，OpenAI 兼容映射 reasoning_effort。",
    controls: "PipelineConfig.thinking_level + thinking_capable → create_chat_model kwargs。",
    options: [
      { value: "off", label: "关闭", effect: "不注入思考参数。" },
      { value: "low", label: "低", effect: "较小 budget / effort。" },
      { value: "medium", label: "中", effect: "默认中档。" },
      { value: "high", label: "高", effect: "更大 budget；可能抬高 max_tokens。" },
    ],
    path: [
      "Settings：thinking_capable + thinking_level 写入 LlmEndpoint。",
      "DimensionRouter 按能力门控：incapable → 强制 off。",
      "arena/thinking.build_thinking_client_kwargs 注入 Anthropic thinking 或 OpenAI reasoning_effort。",
    ],
    lc: "create_chat_model 读 overrides 中的思考字段。",
    lg: "经 begin_pipeline 注入与 LC 相同。",
    modules: [
      "backend/app/arena/thinking.py",
      "backend/app/arena/llm.py",
      "backend/app/config.LlmEndpoint.effective_thinking_level",
    ],
    baselineTip: "对比模型维时用基线统一思考档位；对比本维时钉住接入点。",
    caveats: [
      "部分代理对 reasoning_effort / thinking 字段支持不一致。",
      "思考流会作为独立 SSE thinking 事件，与最终回答分离。",
    ],
  },
  {
    id: "max_steps",
    label: "最大步数",
    field: "max_steps",
    reality: "full",
    summary: "限制 Agent 业务循环深度，防止工具链无限往返。",
    controls: "LangGraph state.max_steps；两侧 recursion_limit 随步数放大。",
    options: [
      { value: "5", label: "5 步", effect: "更早结束循环。" },
      { value: "10", label: "10 步", effect: "默认。" },
      { value: "15", label: "15 步", effect: "更长工具链。" },
      { value: "20", label: "20 步", effect: "允许更深探索。" },
    ],
    path: [
      "LangGraph initial_state.max_steps = config.max_steps。",
      "节点 should_continue 在 step_count >= max_steps 时结束。",
      "recursion_limit = max(50, max_steps×5)（LangGraph）或 max(25, max_steps×4)（LangChain）。",
    ],
    lc: "主要约束底层图 recursion_limit（无独立业务 max_steps 状态）。",
    lg: "业务 max_steps + recursion_limit 双约束。",
    modules: [
      "backend/app/adapters/langgraph_adapter.py",
      "backend/app/adapters/langchain_adapter.py",
      "backend/app/arena/reasoning_graph.py",
      "backend/app/arena/agent_state.py",
    ],
    baselineTip: "对比工具集时可用较小 max_steps 控制成本。",
    caveats: ["LangChain 与 LangGraph 对「步」的计数语义不完全等同。"],
  },
  {
    id: "toolset",
    label: "工具集",
    field: "toolset",
    reality: "full",
    summary: "过滤真实绑定到模型的工具列表（非文案提示）。",
    controls: "ContextVar toolset → get_active_tools() → bind_tools / create_agent。",
    options: TOOLSET_TABLE.map((t) => ({
      value: t.id,
      label: t.label,
      effect: t.tools,
    })),
    path: [
      "begin_pipeline → set_active_toolset(config.toolset)。",
      "LangGraph：_bind_tools 与工具节点查找都用 get_active_tools()。",
      "LangChain：create_agent(llm, get_active_tools(), …)。",
      "finally：clear_active_toolset。",
    ],
    lc: "create_agent 只看到过滤后的工具 schema。",
    lg: "bind_tools 与执行查找同一活动集。",
    modules: [
      "backend/app/arena/tools.py",
      "backend/app/arena/reasoning_graph.py",
      "backend/app/adapters/*_adapter.py",
    ],
    baselineTip: "测文件写入任务时基线用 code_file 或 full。",
    caveats: ["模型仍可能「口述」未绑定工具；实际调用会因未绑定而失败或走未知工具分支。"],
  },
];

export const HONESTY: Array<{ title: string; body: string }> = [
  {
    title: "推理 × LangChain",
    body: "图结构不切换，差异主要在 Prompt；解读时必须写明框架基线。",
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
    body: "除 prepare_messages_for_llm 真实裁剪外，还有策略说明文案叠加。",
  },
  {
    title: "Harness 双通道",
    body: "控制循环真实重试；同时 apply_harness_level 会改 system 文案。",
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

export const TOC_GROUPS: Array<{
  title: string;
  items: Array<{ id: string; label: string }>;
}> = [
  {
    title: "总览",
    items: [
      { id: "method", label: "控制变量法" },
      { id: "field-matrix", label: "字段总表" },
      { id: "baseline", label: "基线机制" },
      { id: "pipeline", label: "运行链路" },
      { id: "toolsets", label: "工具集明细" },
    ],
  },
  {
    title: "对比维度",
    items: DIMENSIONS.map((d) => ({ id: d.id, label: d.label })),
  },
  {
    title: "边界",
    items: [{ id: "honesty", label: "诚实边界" }],
  },
];
