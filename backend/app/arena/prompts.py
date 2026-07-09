"""Prompt Profile 模板 — 控制变量法下仅切换 Prompt 层。"""

from __future__ import annotations

from app.arena.harness import HarnessLevel, apply_harness_level
from app.arena.reasoning import ReasoningMode, apply_reasoning_mode
from app.models import PromptProfile

BASE_SYSTEM = """你是 AgentPrism Arena 中的实验 Agent，使用 ReAct 模式完成任务。
可用工具：get_current_time（获取当前时间）、calculate（计算简单数学表达式）、write_file/create_file/read_file/list_files（文件操作）、run_code（代码执行）。
回答要简洁准确。需要工具时先说明理由再调用。"""

PROFILES: dict[PromptProfile, dict[str, str]] = {
    "zero_shot": {
        "system": BASE_SYSTEM,
        "user_suffix": "",
    },
    "few_shot": {
        "system": BASE_SYSTEM,
        "user_suffix": """
参考示例：
Q: 现在几点？ → Thought: 需要当前时间 → Action: get_current_time → 回答用户
Q: 计算 12*8 → Thought: 需要计算 → Action: calculate(12*8) → 回答 96
""",
    },
    "cot_prompt": {
        "system": BASE_SYSTEM + "\n请始终先逐步推理（Thought），再决定 Action。",
        "user_suffix": "\nLet's think step by step.",
    },
    "structured": {
        "system": BASE_SYSTEM
        + """
最终回答必须是 JSON：
{"reasoning": "...", "answer": "...", "tools_used": ["..."]}
""",
        "user_suffix": "\n以 JSON 格式输出最终结果。",
    },
}


def build_messages(
    question: str,
    profile: PromptProfile,
    reasoning: ReasoningMode = "react",
    harness: HarnessLevel = "bare",
) -> tuple[str, str]:
    """构建 system + user prompt，集成推理模式和 Harness 级别。"""
    cfg = PROFILES[profile]
    system = cfg["system"]
    user = question.strip() + cfg["user_suffix"]

    system, user = apply_reasoning_mode(system, user, reasoning)
    system, user = apply_harness_level(system, user, harness)

    return system, user
