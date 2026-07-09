"""Harness 引擎的单元测试。"""

from app.arena.harness import (
    HarnessRunner,
    apply_harness_level,
    get_harness_description,
)


def test_apply_harness_level_bare():
    sys, usr = apply_harness_level("base", "Q?", "bare")
    assert sys == "base"
    assert usr == "Q?"


def test_apply_harness_level_verify():
    sys, _ = apply_harness_level("base", "Q?", "verify")
    assert "验证" in sys


def test_apply_harness_level_reflect():
    sys, _ = apply_harness_level("base", "Q?", "reflect")
    assert "反思" in sys


def test_apply_harness_level_self_evolve():
    sys, _ = apply_harness_level("base", "Q?", "self_evolve")
    assert "进化" in sys


def test_get_harness_description():
    for level in ("bare", "verify", "reflect", "self_evolve"):
        desc = get_harness_description(level)
        assert len(desc) > 0


def test_harness_runner_bare_zero_retries():
    runner = HarnessRunner(level="bare")
    assert runner.max_retries == 0
    assert runner.attempts == 0


def test_harness_runner_verify_has_retries():
    runner = HarnessRunner(level="verify")
    assert runner.max_retries == 2


def test_harness_runner_reflect_has_retries():
    runner = HarnessRunner(level="reflect")
    assert runner.max_retries == 2


def test_harness_runner_self_evolve_has_retries():
    runner = HarnessRunner(level="self_evolve")
    assert runner.max_retries == 2


def test_harness_runner_tracks_reflections():
    runner = HarnessRunner(level="reflect")
    runner.reflections.append("test insight")
    assert "test insight" in runner.reflections


def test_harness_runner_tracks_edits():
    runner = HarnessRunner(level="self_evolve")
    edit = {"prompt_additions": ["添加示例"], "reasoning": "改进回答"}
    runner.harness_edits.append(edit)
    assert runner.harness_edits[0]["prompt_additions"] == ["添加示例"]
