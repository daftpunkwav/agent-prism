/**
 * @file catalogs/zh-CN/dimensions
 * @description zh-CN copy for the dimension label overlay (source of truth).
 *
 * Responsibilities:
 * - Define the dimensions namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const dimensions = {
  currentSuffix: "（当前）",
  field: {
    framework: "框架",
    prompt: "提示词",
    reasoning: "推理模式",
    context: "上下文",
    harness: "Harness",
    temperature: "温度",
    model: "模型",
    thinking: "思考强度",
    max_steps: "最大步数",
    toolset: "工具集",
    mcp: "MCP",
    skill: "Skill",
    orchestration: "编排",
    memory: "记忆",
  },
  subtitle: {
    framework: "编排实现不同，其余维由基线固定",
    prompt: "仅切换 Prompt 模板，其余维由基线固定",
    reasoning: "控制流模式差异（react/cot/tot/reflexion/自一致性），各列独立磁盘工作空间",
    context: "滑动/摘要/向量在每次 LLM 调用前真实裁剪",
    harness: "维度列固定 Native：三条驱动共享 VerificationPolicy（verify/reflect/self_evolve 真正重试）",
    temperature: "真实写入 LLM temperature（采样随机性）",
    model: "切换 Settings 接入点（跨厂或同连接多 model）；解码参数由基线钉死",
    thinking: "off/low/medium/high；模型须在 Settings 勾选「支持思考」才真正启用",
    max_steps: "Native/LangGraph 按 LLM 轮次硬预算；LangChain 仅 recursion_limit 近似",
    toolset: "真实过滤 bind_tools / create_agent 工具列表",
    mcp: "把 MCP filesystem/fetch 服务器桥接进工具列表；off / fs / full 决定模型可调用的工具",
    skill: "off 禁用 skill 工具；on-demand 经 skill 工具按需加载；preloaded 注入 runbook 到 prompt",
    orchestration: "direct 自由执行；plan-first 预置 plan 文档；goal-first 预置可追踪目标",
    memory: "跨会话记忆挂载进 prompt；none 无记忆，episodic 挂历史经验，semantic 挂项目事实，full 两者都挂",
  },
  baselineField: {
    framework: "框架",
    prompt_profile: "提示词",
    reasoning: "推理模式",
    context: "上下文",
    harness: "Harness",
    temperature: "温度",
    endpoint_id: "模型",
    model_id: "模型",
    thinking_level: "思考强度",
    max_steps: "最大步数",
    toolset: "工具集",
    top_p: "Top P",
    frequency_penalty: "Frequency Penalty",
    presence_penalty: "Presence Penalty",
    max_output_tokens: "最大输出 tokens",
    mcp_policy: "MCP",
    skill_policy: "Skill",
    approval_mode: "审批模式",
    sandbox_mode: "沙箱模式",
    orchestration: "编排",
    memory: "记忆",
  },
  opt: {
    framework: {
      native: "Native Agent",
      langchain: "LangChain",
      langgraph: "LangGraph",
      plan_execute: "Plan-Execute",
      self_critique: "Self-Critique",
      autogen: "AutoGen 群聊",
      crewai: "CrewAI 班组",
    },
    prompt: {
      zero_shot: "Zero-shot",
      few_shot: "Few-shot",
      cot_prompt: "CoT Prompt",
      structured: "Structured",
    },
    reasoning: {
      react: "ReAct",
      cot_tool: "CoT+Tool",
      tot: "ToT",
      reflexion: "Reflexion",
      self_consistency: "自一致性",
    },
    context: {
      sliding: "滑动窗口",
      summary: "摘要压缩",
      vector: "向量检索",
      hybrid: "混合策略",
    },
    harness: {
      bare: "裸运行",
      verify: "验证循环",
      reflect: "反思循环",
      self_evolve: "自进化",
    },
    toolset: {
      full: "全工具",
      edit_run: "读写+运行",
      read_only: "只读",
    },
    thinking: {
      off: "关闭",
      low: "低",
      medium: "中",
      high: "高",
    },
    temperature: {
      "0": "0（确定性）",
      "0_3": "0.3",
      "0_7": "0.7",
      "1": "1.0",
    },
    max_steps: {
      "5": "5 步",
      "10": "10 步",
      "15": "15 步",
      "20": "20 步",
    },
    mcp: {
      off: "MCP off（仅内置工具）",
      fs: "MCP filesystem 服务器",
      full: "MCP filesystem + fetch",
    },
    skill: {
      off: "禁用 Skills",
      on_demand: "按需经 skill 工具加载",
      preloaded: "预载入 prompt",
    },
    orchestration: {
      direct: "直接执行",
      plan_first: "Plan-first（先出计划）",
      goal_first: "Goal-first（先定目标）",
    },
    memory: {
      none: "无记忆（无状态）",
      episodic: "情景记忆（历史任务经验）",
      semantic: "语义记忆（项目事实）",
      full: "完整记忆（经验 + 事实）",
    },
  },
  baselineOpt: {
    approval_mode: {
      auto: "自动（仅拒绝灾难性命令）",
      unless_trusted: "仅已知安全命令",
    },
    sandbox_mode: {
      off: "关闭（仅分析与审批）",
      os: "OS 写沙箱（仅工作区可写）",
    },
  },
};
