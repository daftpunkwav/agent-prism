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


def test_duplicate_selections_deduplicated(router):
    """重复 selections 应去重，避免产生重复 pipeline（双倍 LLM 成本）。"""
    configs = router.route("framework", selections=["langchain", "langchain", "langgraph"])
    assert [c.framework for c in configs] == ["langchain", "langgraph"]


def test_all_dimensions_route_successfully(router):
    """所有 5 个维度均能 route 出 ≥2 条 pipeline。"""
    for dim in ("framework", "prompt", "reasoning", "context", "harness"):
        configs = router.route(dim)  # type: ignore[arg-type]
        assert len(configs) >= 2
