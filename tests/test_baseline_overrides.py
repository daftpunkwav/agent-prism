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


def test_list_baseline_fields_covers_all_dims():
    fields = list_baseline_fields()
    dims = {f["dimension"] for f in fields if f.get("dimension")}
    assert dims == {
        "framework",
        "prompt",
        "reasoning",
        "context",
        "harness",
        "temperature",
        "model",
        "thinking",
        "max_steps",
        "toolset",
    }
    only = {f["field"] for f in fields if f.get("dimension") is None}
    assert "top_p" in only
    assert "max_output_tokens" in only
    assert "frequency_penalty" in only
    assert "presence_penalty" in only


def test_baseline_ignores_model_id_when_endpoint_present(router):
    """前端曾同时下发 endpoint_id + model_id，不得因此整次路由失败。"""
    from app.arena.router import reset_dimension_options, sync_model_options_from_provider
    from app.config import LlmEndpoint, ProviderConfig

    ep = LlmEndpoint(
        id="ep-a",
        label="A",
        provider_name="x",
        api_format="openai_chat",
        base_url="https://example.com/v1",
        api_key="k",
        model="m-a",
    )
    sync_model_options_from_provider(
        ProviderConfig(endpoints=[ep], default_endpoint_id="ep-a")
    )
    try:
        configs = router.route(
            "framework",
            baseline=BaselineOverrides(
                endpoint_id="ep-a", model_id="m-a", temperature=0.3
            ),
        )
        assert len(configs) >= 2
        assert all(c.endpoint_id == "ep-a" for c in configs)
        assert all(c.temperature == 0.3 for c in configs)
    finally:
        reset_dimension_options()


def test_baseline_model_id_maps_to_endpoint_when_alone(router):
    """仅 model_id（旧客户端）时应映射为对应 endpoint_id。"""
    from app.arena.router import reset_dimension_options, sync_model_options_from_provider
    from app.config import LlmEndpoint, ProviderConfig

    ep = LlmEndpoint(
        id="ep-b",
        label="B",
        provider_name="x",
        api_format="openai_chat",
        base_url="https://example.com/v1",
        api_key="k",
        model="legacy-model",
    )
    sync_model_options_from_provider(
        ProviderConfig(endpoints=[ep], default_endpoint_id="ep-b")
    )
    try:
        configs = router.route(
            "framework",
            baseline=BaselineOverrides(model_id="legacy-model"),
        )
        assert len(configs) >= 2
        assert all(c.endpoint_id == "ep-b" for c in configs)
    finally:
        reset_dimension_options()


def test_baseline_top_p_on_framework_dim(router):
    configs = router.route(
        "framework",
        baseline=BaselineOverrides(top_p=0.8, max_output_tokens=1024),
    )
    assert all(c.top_p == 0.8 for c in configs)
    assert all(c.max_output_tokens == 1024 for c in configs)


def test_baseline_toolset_and_max_steps(router):
    configs = router.route(
        "framework",
        baseline=BaselineOverrides(toolset="calc_time", max_steps=5, temperature=0.3),
    )
    assert all(c.toolset == "calc_time" for c in configs)
    assert all(c.max_steps == 5 for c in configs)
    assert all(c.temperature == 0.3 for c in configs)
