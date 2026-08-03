"""Arena 公共 Literal 类型 — 跨模块单一来源，避免重复定义。"""

from __future__ import annotations

from typing import Literal

# 对比维度（含 LLM / 步数 / 工具集等真实控制变量）
DimensionId = Literal[
    "framework",
    "prompt",
    "reasoning",
    "context",
    "harness",
    "temperature",
    "model",
    "thinking",
    "max_steps",
    "toolset",
]

# 思考强度（off=关闭；low/medium/high 映射为 budget / effort）
ThinkingLevel = Literal["off", "low", "medium", "high"]

# Prompt 策略
PromptProfile = Literal["zero_shot", "few_shot", "cot_prompt", "structured"]

# 推理模式
ReasoningMode = Literal["react", "cot_tool", "tot", "reflexion"]

# 上下文策略
ContextStrategy = Literal["sliding", "summary", "vector", "hybrid"]

# Harness 引擎级别
HarnessLevel = Literal["bare", "verify", "reflect", "self_evolve"]

# 工具集预设（过滤 ARENA_TOOLS，真实绑定）
ToolsetId = Literal["full", "code_file", "calc_time", "workspace_read"]

# LLM Provider API 格式
ApiFormat = Literal["anthropic_messages", "openai_chat"]

# ArenaEvent 类型（前端流式渲染时细分 thought / action / observation 等）
EventType = Literal[
    "thought",
    "thought_delta",
    "thought_end",
    "action",
    "observation",
    "verify",
    "reflect",
    "harness_edit",
    "complete",
    "error",
    "token_update",
    "thinking",
]
