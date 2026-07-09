"""Arena 公共 Literal 类型 — 跨模块单一来源，避免重复定义。"""

from __future__ import annotations

from typing import Literal

# 5 个对比维度
DimensionId = Literal["framework", "prompt", "reasoning", "context", "harness"]

# Prompt 策略
PromptProfile = Literal["zero_shot", "few_shot", "cot_prompt", "structured"]

# 推理模式
ReasoningMode = Literal["react", "cot_tool", "tot", "reflexion"]

# 上下文策略
ContextStrategy = Literal["sliding", "summary", "vector", "hybrid"]

# Harness 引擎级别
HarnessLevel = Literal["bare", "verify", "reflect", "self_evolve"]

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
    "complete",
    "error",
    "token_update",
    "thinking",
]
