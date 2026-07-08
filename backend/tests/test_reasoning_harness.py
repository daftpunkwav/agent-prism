"""推理模式引擎和 Harness 引擎的单元测试。"""


from app.arena.harness import apply_harness_level, get_harness_description
from app.arena.reasoning import apply_reasoning_mode, get_reasoning_description


def test_react_adds_react_suffix():
    sys, usr = apply_reasoning_mode("base", "Q?", "react")
    assert "ReAct" in sys
    assert "Thought" in sys
    assert "Action" in sys
    assert "Observation" in sys


def test_cot_tool_adds_chain_of_thought_suffix():
    sys, usr = apply_reasoning_mode("base", "Q?", "cot_tool")
    assert "Chain-of-Thought" in sys or "推理链" in sys
    assert "请先详细分析" in usr


def test_tot_adds_tree_of_thought_suffix():
    sys, usr = apply_reasoning_mode("base", "Q?", "tot")
    assert "Tree-of-Thought" in sys or "多分支" in sys


def test_reflexion_adds_reflexion_suffix():
    sys, usr = apply_reasoning_mode("base", "Q?", "reflexion")
    assert "Reflexion" in sys or "反思" in sys


def test_all_reasoning_modes_have_descriptions():
    for mode in ("react", "cot_tool", "tot", "reflexion"):
        desc = get_reasoning_description(mode)
        assert len(desc) > 0


def test_harness_bare_adds_no_suffix():
    sys, usr = apply_harness_level("base", "Q?", "bare")
    assert sys == "base"
    assert usr == "Q?"


def test_harness_verify_adds_validation():
    sys, usr = apply_harness_level("base", "Q?", "verify")
    assert "验证" in sys


def test_harness_reflect_adds_reflection():
    sys, usr = apply_harness_level("base", "Q?", "reflect")
    assert "反思" in sys


def test_harness_self_evolve_adds_evolution():
    sys, usr = apply_harness_level("base", "Q?", "self_evolve")
    assert "进化" in sys


def test_all_harness_levels_have_descriptions():
    for level in ("bare", "verify", "reflect", "self_evolve"):
        desc = get_harness_description(level)
        assert len(desc) > 0
