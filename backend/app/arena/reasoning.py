"""推理模式引擎 — 不同的推理编排方式。"""

from __future__ import annotations

from typing import Literal

ReasoningMode = Literal["react", "cot_tool", "tot", "reflexion"]


REASONING_PROMPTS: dict[ReasoningMode, dict[str, str]] = {
    "react": {
        "system_suffix": "\n\n使用 ReAct 模式：先思考（Thought），再决定行动（Action），最后观察结果（Observation），循环直到完成任务。",
        "user_suffix": "",
    },
    "cot_tool": {
        "system_suffix": "\n\n使用 Chain-of-Thought + Tool 模式：先用完整推理链分析问题，规划好所有需要的步骤，然后统一执行工具调用。",
        "user_suffix": "\n\n请先详细分析问题，列出推理步骤，再执行工具。",
    },
    "tot": {
        "system_suffix": "\n\n使用 Tree-of-Thought 模式：对每个步骤生成多个候选方案，评估每个方案，选择最优方案继续。",
        "user_suffix": "",
    },
    "reflexion": {
        "system_suffix": "\n\n使用 Reflexion 模式：执行后评估结果质量，反思改进方向，必要时重试。最多重试 2 次。",
        "user_suffix": "",
    },
}


def apply_reasoning_mode(
    base_system: str,
    base_user: str,
    mode: ReasoningMode,
) -> tuple[str, str]:
    """根据推理模式调整 system 和 user prompt。"""
    cfg = REASONING_PROMPTS.get(mode, REASONING_PROMPTS["react"])
    system = base_system + cfg["system_suffix"]
    user = base_user + cfg["user_suffix"]
    return system, user


def get_reasoning_description(mode: ReasoningMode) -> str:
    descriptions = {
        "react": "标准 ReAct：Thought → Action → Observation 循环",
        "cot_tool": "CoT+Tool：先完整推理链，再统一调用工具",
        "tot": "ToT：多分支探索，评估后选最优",
        "reflexion": "Reflexion：执行 → 评估 → 反思 → 重试",
    }
    return descriptions.get(mode, "")
