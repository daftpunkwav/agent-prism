"""基线覆盖（控制变量）路由测试。"""

from __future__ import annotations

import pytest

from app.arena.router import DimensionRouter, list_baseline_fields
from app.models import BaselineOverrides


@pytest.fixture
def router() -> DimensionRouter:
    return DimensionRouter()


def test_baseline_overrides_reasoning_on_framework_dim(router):
    configs = router.route(
        "framework",
        baseline=BaselineOverrides(reasoning="tot", prompt_profile="few_shot"),
    )
    assert len(configs) == 2
    assert {c.framework for c in configs} == {"langchain", "langgraph"}
    assert all(c.reasoning == "tot" for c in configs)
    assert all(c.prompt_profile == "few_shot" for c in configs)


def test_baseline_cannot_override_active_dimension_field(router):
    """对比框架时 baseline.framework 被忽略。"""
    configs = router.route(
        "framework",
        baseline=BaselineOverrides(framework="langchain", reasoning="reflexion"),
    )
    assert [c.framework for c in configs] == ["langchain", "langgraph"]
    assert all(c.reasoning == "reflexion" for c in configs)


def test_baseline_invalid_value_raises(router):
    with pytest.raises(ValueError, match="不支持的取值"):
        router.route("prompt", baseline=BaselineOverrides(reasoning="nope"))  # type: ignore[arg-type]


def test_list_baseline_fields_covers_five_dims():
    fields = list_baseline_fields()
    assert len(fields) == 5
    dims = {f["dimension"] for f in fields}
    assert dims == {"framework", "prompt", "reasoning", "context", "harness"}
