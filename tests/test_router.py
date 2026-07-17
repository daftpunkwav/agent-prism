"""维度路由的单元测试。"""

import pytest

from app.arena.router import DimensionRouter


@pytest.fixture
def router() -> DimensionRouter:
    return DimensionRouter()


def test_framework_dimension_yields_two_pipelines(router):
    configs = router.route("framework")
    assert [c.framework for c in configs] == ["langchain", "langgraph"]
    assert [c.label for c in configs] == ["LangChain", "LangGraph"]


def test_prompt_dimension_yields_four_profiles(router):
    configs = router.route("prompt")
    assert [c.prompt_profile for c in configs] == [
        "zero_shot",
        "few_shot",
        "cot_prompt",
        "structured",
    ]


def test_column_count_matches_route_length(router):
    assert router.column_count("framework") == 2
    assert router.column_count("prompt") == 4


def test_unknown_dimension_raises(router):
    with pytest.raises(ValueError):
        router.route("nonexistent")  # type: ignore[arg-type]


def test_all_dimensions_are_mvp_ready(router):
    assert router.is_mvp_ready("framework") is True
    assert router.is_mvp_ready("prompt") is True
    assert router.is_mvp_ready("reasoning") is True
    assert router.is_mvp_ready("context") is True
    assert router.is_mvp_ready("harness") is True
