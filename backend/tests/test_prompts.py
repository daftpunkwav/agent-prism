"""Prompt Profile 构建的单元测试。"""

from app.arena.prompts import BASE_SYSTEM, build_messages


def test_zero_shot_strips_and_no_suffix():
    system, user = build_messages("  现在几点？  ", "zero_shot")
    assert system == BASE_SYSTEM
    assert user == "现在几点？"


def test_cot_prompt_adds_reasoning_hint():
    system, user = build_messages("计算 12*8", "cot_prompt")
    assert "逐步推理" in system
    assert user.endswith("Let's think step by step.")


def test_structured_requires_json_output():
    system, user = build_messages("问题", "structured")
    assert "JSON" in system
    assert "JSON" in user
