"""Harness 引擎 — 验证/反思/自进化循环。"""

from __future__ import annotations

from typing import Literal

HarnessLevel = Literal["bare", "verify", "reflect", "self_evolve"]


HARNESS_PROMPTS: dict[HarnessLevel, dict[str, str]] = {
    "bare": {
        "system_suffix": "",
        "user_suffix": "",
    },
    "verify": {
        "system_suffix": "\n\n执行后验证：检查答案是否准确回答了问题，格式是否正确。若验证失败，重试最多 2 次。",
        "user_suffix": "",
    },
    "reflect": {
        "system_suffix": "\n\n执行 → 评估 → 反思：完成后分析结果质量，反思哪里可以改进。若反思发现有更优方案，记录并调整。",
        "user_suffix": "",
    },
    "self_evolve": {
        "system_suffix": "\n\n执行 → 评估 → 反思 → 自进化：分析本次执行的弱点，提出具体的 Prompt / 工具选择改进，记录改进建议。",
        "user_suffix": "",
    },
}


def apply_harness_level(
    base_system: str,
    base_user: str,
    level: HarnessLevel,
) -> tuple[str, str]:
    """根据 Harness 级别调整 system 和 user prompt。"""
    cfg = HARNESS_PROMPTS.get(level, HARNESS_PROMPTS["bare"])
    system = base_system + cfg["system_suffix"]
    user = base_user + cfg["user_suffix"]
    return system, user


def get_harness_description(level: HarnessLevel) -> str:
    descriptions = {
        "bare": "裸运行：LLM 输出即结果，无验证",
        "verify": "验证循环：检查答案质量，不通过则重试",
        "reflect": "反思循环：验证 + 反思改进",
        "self_evolve": "自进化：反思 + 提出自身改进方案",
    }
    return descriptions.get(level, "")
