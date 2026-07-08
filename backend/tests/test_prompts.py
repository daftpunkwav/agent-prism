"""Prompt Profile 构建的单元测试。"""

from app.arena.prompts import BASE_SYSTEM, build_messages


def test_zero_shot_strips_and_no_suffix():
    # zero_shot 无额外 suffix，但默认加入 reasoning + harness 后缀
    system, user = build_messages("  现在几点？  ", "zero_shot")
    # system 包含 base + reasoning(react) + harness(bare) 后缀
    assert system.startswith(BASE_SYSTEM)
    assert "ReAct" in system
    assert user == "现在几点？"


def test_cot_prompt_adds_reasoning_hint():
    system, user = build_messages("计算 12*8", "cot_prompt")
    assert "逐步推理" in system
    assert user.endswith("Let's think step by step.")


def test_structured_requires_json_output():
    system, user = build_messages("问题", "structured")
    assert "JSON" in system
    assert "JSON" in user
