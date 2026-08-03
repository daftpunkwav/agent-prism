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

/** 多轮对话机制说明（各列共享历史，非 PipelineConfig 字段）。 */
export const MULTI_TURN_DOC = {
  title: "多轮对话",
  summary:
    "Arena 支持在同一组对比列上连续追问：各列共享 `messages` 对话历史，每轮仅 `question` 变化。历史不含本轮输入，由前端在运行成功后追加 user/assistant 对。",
  mechanics: [
    "请求体：`question`（本轮）+ `messages[]`（此前 user/assistant 交替历史，最多 24 条）。",
    "各对比列接收相同 `messages` 与 `question`，仅 PipelineConfig 在对比维上不同。",
    "Adapter 经 `build_initial_lc_messages(system, user, history)` 组装：System → 历史 → 本轮 Human。",
    "SSE 事件携带 `turn`（1-based）：后端按 `len(messages) // 2 + 1` 派生，供前端按轮分段展示。",
  ],
  limits: [
    "单条消息最长 4000 字符；历史总字符上限 24000（超出则请求校验失败）。",
    "工作空间在列级别持久：多轮追问不会重置各列已写入的文件。",
    "自动判分针对每轮最终答案独立触发；对比报告可按轮次折叠查看。",
  ],
  modules: [
    "backend/app/models.py · ChatMessage / ArenaRunRequest.messages",
    "backend/app/adapters/_common_run.py · build_initial_lc_messages",
    "backend/app/arena/runner.py · history 透传与 turn 标注",
  ],
};

/** 对比展示形式（按轮次分段，非新增对比维）。 */
export const COMPARE_FORMS: Array<{ title: string; body: string }> = [
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

export const PIPELINE_STAGES: Array<{
  title: string;
  detail: string;
  module: string;
}> = [
  {
    title: "请求入场",
    detail:
      "前端 POST /api/arena/run，携带 dimension、selections、baseline、messages（共享历史）与 question（本轮）。服务端用 Semaphore 限制并发。",
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
  {
    title: "多轮历史共享",
    body: "messages 在列间相同，不随对比维变化；各列仅在本轮 run 的 PipelineConfig 上分化。历史由前端维护，后端校验条数与总字符上限。",
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
    summary:
      "切换 Agent 编排运行时（LangChain vs LangGraph）。在相同问题、相同基线与相同对话历史下，比较两框架在工具调用节奏、循环深度与流式事件形态上的差异。",
    controls:
      "决定 `RunnerPool` 为每列实例化哪一个 `FrameworkAdapter.run`；影响 create_agent 与 StateGraph 两条执行路径。",
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
      "多轮时两 Adapter 均经 build_initial_lc_messages 注入共享历史，框架差异体现在本轮编排循环。",
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
    baselineTip: "测 Prompt / 上下文 / Harness 时常用 langgraph 作框架基线；多轮追问时保持框架基线不变，便于观察编排差异是否随轮次放大。",
    caveats: [
      "新增框架需实现 FrameworkAdapter 并 register，才会出现在维度选项中。",
      "LangChain 对 max_steps 的语义与 LangGraph 不完全等同，跨框架对比步数时请结合 Trace 逐步核对。",
    ],
  },
  {
    id: "prompt",
    label: "提示词",
    field: "prompt_profile",
    reality: "full",
    summary:
      "只切换 Prompt 模板层（system / user_suffix），不改图结构、工具绑定或上下文裁剪逻辑。适合隔离「文案策略」对格式遵从、推理深度与工具选择的影响。",
    controls:
      "build_messages 的 profile 参数 → PROFILES[profile]；在 system 与 user_suffix 段注入模板差异。",
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
      "多轮时 profile 段每轮重建，历史 Human/AI 消息保留在 messages 中不受 profile 覆盖。",
    ],
    lc: "与 LangGraph 相同：都经 build_messages；差异不在框架侧。",
    lg: "同上。",
    modules: ["backend/app/arena/prompts.py", "backend/app/adapters/_common_run.py"],
    baselineTip: "对比框架时可用 structured 检验格式遵从是否因编排而不同；多轮实验可用 few_shot 观察示例是否被后续轮次「记住」。",
    caveats: [
      "「CoT Prompt」≠ 推理维的 CoT+Tool：前者只改文案，后者改 LangGraph 节点。",
      "structured 模板在多轮追问中可能因历史干扰而降低 JSON 遵从率，需结合 Trace 逐步排查。",
    ],
  },
  {
    id: "reasoning",
    label: "推理模式",
    field: "reasoning",
    reality: "partial",
    summary:
      "控制 Agent 的思考与调工具编排策略。LangGraph 会切换 StateGraph 节点拓扑；LangChain 主要通过 Prompt 后缀模拟，图骨架不变。",
    controls:
      "Prompt 后缀（apply_reasoning_mode）+（仅 LangGraph）REASONING_MODES[mode].graph_builder 图选择。",
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
      "LangGraph：spec.graph_builder 编译不同节点图（ReAct / CoT+Tool / ToT / Reflexion）。",
      "LangChain：create_agent 骨架固定；开场 thought 标注「推理=仅 Prompt」。",
      "多轮时反思类模式（reflexion）可能在前轮错误基础上自我纠错，适合按轮对比 Trace。",
    ],
    lc: "图不切换；差异来自 Prompt 后缀与模型行为。",
    lg: "真实切换 ReAct / CoT+Tool / ToT / Reflexion 图结构。",
    modules: [
      "backend/app/arena/reasoning_graph.py",
      "backend/app/arena/reasoning.py",
      "backend/app/adapters/langgraph_adapter.py",
      "backend/app/adapters/langchain_adapter.py",
    ],
    baselineTip: "对比本维时，框架基线请保持 langgraph，否则看不到图结构差异；多轮追问时 reflexion 与 react 的差异更明显。",
    caveats: [
      "reality=partial：LangChain 列差异主要在 Prompt，解读时必须标明框架基线。",
      "ToT 多候选评估会显著增加 Token 与耗时，多轮叠加时成本上升更快。",
    ],
  },
  {
    id: "context",
    label: "上下文",
    field: "context",
    reality: "full",
    summary:
      "控制每次 LLM 调用前如何裁剪、摘要或检索补充消息历史。直接影响多轮对话中「早期轮次信息是否被保留」——是与多轮实验关系最紧密的对比维之一。",
    controls:
      "prepare_messages_for_llm(strategy) 真实裁剪 + Prompt 层 _CONTEXT_HINTS 策略说明文案。",
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
      "多轮时 messages 随轮次增长，滑动窗口与摘要策略的差异在第 2 轮起即显现。",
    ],
    lc: "中间件真实裁剪；与策略文案叠加。",
    lg: "图内每次 LLM 调用真实裁剪。",
    modules: [
      "backend/app/arena/context_manager.py",
      "backend/app/arena/message_sanitize.py",
      "backend/app/arena/rag.py",
      "backend/app/adapters/langchain_adapter.py",
    ],
    baselineTip: "长工具链或多轮追问任务优先测 summary / vector / hybrid；建议至少跑 3 轮再下结论。",
    caveats: [
      "vector 依赖当前工作区已有文件；空工作区时检索为空。",
      "多轮共享 messages 时，各列上下文策略不同会导致「同一历史、不同裁剪」——这正是本维要测量的效应。",
      "摘要策略可能丢失精确数字或代码细节，判分失败时需回看被压缩的轮次。",
    ],
  },
  {
    id: "harness",
    label: "Harness",
    field: "harness",
    reality: "full",
    summary:
      "在 Agent 编排外层叠加验证 / 反思 / 自进化控制循环，用于检验「失败后能否自动纠正」以及 Prompt 增补是否安全有效。",
    controls:
      "HarnessRunner(level) 包裹 graph/agent 执行流 + apply_harness_level 追加 system 后缀。",
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
      "非 bare：提取答案 → verify → 可选 reflect/edit → 重建 messages 后重试（最多 2 次含首次）。",
      "SSE 可出现 verify / reflect / harness_edit 事件，按 turn 分段展示。",
      "多轮追问时 Harness 仅作用于本轮 run 内的重试，不跨轮累积。",
    ],
    lc: "对 create_agent 图同样包一层 HarnessRunner。",
    lg: "对编译后的推理图包一层 HarnessRunner。",
    modules: ["backend/app/arena/harness.py", "backend/app/adapters/*_adapter.py"],
    baselineTip: "测 Prompt 改进是否「真有效」时，常用 verify 作基线或对比维；多轮任务可在第 2 轮故意给出模糊追问，观察 verify 是否拦截低质量回答。",
    caveats: [
      "自进化的 prompt 增补有长度与注入清洗；不会执行任意代码。",
      "Harness 重试会增加单轮耗时与 Token，对比报告需区分「轮次」与「轮内重试」。",
    ],
  },
  {
    id: "temperature",
    label: "温度",
    field: "temperature",
    reality: "full",
    summary:
      "LLM 采样温度，直接控制输出随机性与探索程度。对比本维时各列温度不同，其余解码参数由基线钉死，适合隔离「随机性」对稳定性与创造性的影响。",
    controls:
      "set_pipeline_llm_overrides(temperature=…) → create_chat_model(temperature=…)；对比维时跳过请求级全局 temperature。",
    options: [
      { value: "0", label: "0", effect: "偏确定性。" },
      { value: "0.3", label: "0.3", effect: "轻度随机。" },
      { value: "0.7", label: "0.7", effect: "中等探索。" },
      { value: "1", label: "1.0", effect: "更高随机。" },
    ],
    path: [
      "路由选项为字符串，写入 PipelineConfig 时转为 float。",
      "优先级：显式参数 > ContextVar overrides > ProviderConfig。",
      "对比本维时，ArenaRunRequest.temperature 全局覆盖被跳过，各列独立生效。",
      "多轮时温度在每轮 run 重新注入；高温度列的跨轮一致性通常更差。",
    ],
    lc: "create_chat_model(temperature=config.temperature)。",
    lg: "图内 create_chat_model 读 ContextVar overrides。",
    modules: ["backend/app/arena/llm.py", "backend/app/arena/router.py", "backend/app/arena/runner.py"],
    baselineTip: "对比框架/推理时常用 0 降低采样噪声；测创造性任务（如文案生成）可对比 0.7 vs 1.0。",
    caveats: [
      "Provider 原始温度会吸附到最近档位（0 / 0.3 / 0.7 / 1）作为默认基线。",
      "温度为 0 并不保证完全确定性：部分 Provider 仍有微小浮动或缓存差异。",
    ],
  },
  {
    id: "model",
    label: "模型",
    field: "endpoint_id",
    reality: "full",
    summary:
      "切换 LLM 接入点（跨厂不同 URL/Key，或同厂同连接不同 model）。解码参数（温度、Top P、思考强度等）由统一基线钉死，确保对比的是「模型能力」而非参数差异。",
    controls:
      "PipelineConfig.endpoint_id → ContextVar 连接覆盖 + model 字段；经 create_chat_model 实例化。",
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
      "对比模型维时 temperature / top_p / max_output_tokens / thinking_level 等来自基线，各列相同。",
      "不足 2 个接入点时 meta.model_compare_ready=false，UI 禁用本维。",
      "多轮时各列模型一致接收相同 messages，差异体现在推理与工具调用质量。",
    ],
    lc: "create_chat_model 读 ContextVar 连接与 model。",
    lg: "经 begin_pipeline 注入完整 overrides。",
    modules: [
      "backend/app/config.LlmEndpoint / ProviderConfig.endpoints",
      "backend/app/arena/router.sync_model_options_from_provider",
      "backend/app/arena/llm.py",
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
    field: "thinking_level",
    reality: "full",
    summary:
      "对比 off / low / medium / high 四档思考强度。模型须在 Settings 勾选「支持思考」；Anthropic 映射 budget_tokens，OpenAI 兼容映射 reasoning_effort。思考流与最终回答分轨展示。",
    controls:
      "PipelineConfig.thinking_level + endpoint.thinking_capable → create_chat_model 注入思考 kwargs。",
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
      "SSE 以独立 thinking 事件流式回传，Trace 中与 thought 分开展示。",
    ],
    lc: "create_chat_model 读 overrides 中的思考字段。",
    lg: "经 begin_pipeline 注入与 LC 相同。",
    modules: [
      "backend/app/arena/thinking.py",
      "backend/app/arena/llm.py",
      "backend/app/config.LlmEndpoint.effective_thinking_level",
    ],
    baselineTip: "对比模型维时用基线统一思考档位；对比本维时钉住接入点与温度，观察思考预算对复杂推理任务的边际收益。",
    caveats: [
      "部分代理对 reasoning_effort / thinking 字段支持不一致，异常时检查 Provider 日志。",
      "思考流会作为独立 SSE thinking 事件，与最终回答分离；判分仅看最终答案。",
      "高档思考会显著增加 output_tokens 与耗时，多轮叠加时成本需纳入实验设计。",
    ],
  },
  {
    id: "max_steps",
    label: "最大步数",
    field: "max_steps",
    reality: "full",
    summary:
      "限制 Agent 业务循环深度（工具往返次数），防止无限循环并控制成本。LangGraph 有独立 step_count 状态；LangChain 主要依赖底层 recursion_limit。",
    controls:
      "LangGraph：state.max_steps + should_continue 判断；两侧：recursion_limit 随步数放大作为安全网。",
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
      "步数用尽时 Agent 可能给出不完整答案，判分失败需结合 Trace 最后几步判断。",
    ],
    lc: "主要约束底层图 recursion_limit（无独立业务 max_steps 状态）。",
    lg: "业务 max_steps + recursion_limit 双约束。",
    modules: [
      "backend/app/adapters/langgraph_adapter.py",
      "backend/app/adapters/langchain_adapter.py",
      "backend/app/arena/reasoning_graph.py",
      "backend/app/arena/agent_state.py",
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
    field: "toolset",
    reality: "full",
    summary:
      "过滤真实绑定到模型的工具列表（非文案提示）。决定 Agent 能调用哪些 Tool schema，直接影响可完成的任务类型与误调用风险。",
    controls:
      "ContextVar active_toolset → get_active_tools() → bind_tools / create_agent；finally 清理防串列。",
    options: TOOLSET_TABLE.map((t) => ({
      value: t.id,
      label: t.label,
      effect: t.tools,
    })),
    path: [
      "begin_pipeline → set_active_toolset(config.toolset)。",
      "LangGraph：_bind_tools 与工具节点查找都用 get_active_tools()。",
      "LangChain：create_agent(llm, get_active_tools(), …)。",
      "finally：clear_active_toolset，避免列间泄漏。",
      "多轮时工作区文件跨轮保留，workspace_read 与 code_file 在多轮文件任务中差异显著。",
    ],
    lc: "create_agent 只看到过滤后的工具 schema。",
    lg: "bind_tools 与执行查找同一活动集。",
    modules: [
      "backend/app/arena/tools.py",
      "backend/app/arena/reasoning_graph.py",
      "backend/app/adapters/*_adapter.py",
    ],
    baselineTip: "测文件写入任务时基线用 code_file 或 full；对比本维时建议固定 max_steps 与框架，隔离工具可用性效应。",
    caveats: [
      "模型仍可能「口述」未绑定工具；实际调用会因未绑定而失败或走未知工具分支。",
      "tool_guard 与 toolset 是两层独立机制：前者拦截跑题调用，后者限制可用集合。",
    ],
  },
];

export const HONESTY: Array<{ title: string; body: string }> = [
  {
    title: "多轮对话",
    body: "messages 各列共享、不随对比维变化；turn 是 SSE 展示元数据而非 PipelineConfig 字段。按轮对比 Trace / 报告时，请确认每轮基线与对比维一致。",
  },
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
      { id: "multi-turn", label: "多轮与按轮对比" },
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
