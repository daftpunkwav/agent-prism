"""思考强度映射与路由门控。"""

from __future__ import annotations

from app.arena.router import (
    DimensionRouter,
    list_baseline_fields,
    reset_dimension_options,
    sync_model_options_from_provider,
)
from app.arena.thinking import build_thinking_client_kwargs, thinking_budget
from app.config import LlmEndpoint, ProviderConfig
from app.models import BaselineOverrides


def test_thinking_budget_levels():
    assert thinking_budget("off") == 0
    assert thinking_budget("low") == 2048
    assert thinking_budget("high") == 16384


def test_build_thinking_off_or_incapable():
    assert (
        build_thinking_client_kwargs(
            api_format="anthropic_messages",
            level="high",
            thinking_capable=False,
            max_tokens=2048,
        )
        == {}
    )
    assert (
        build_thinking_client_kwargs(
            api_format="openai_chat",
            level="off",
            thinking_capable=True,
            max_tokens=2048,
        )
        == {}
    )


def test_build_thinking_anthropic_raises_max_tokens():
    kw = build_thinking_client_kwargs(
        api_format="anthropic_messages",
        level="medium",
        thinking_capable=True,
        max_tokens=2048,
    )
    assert kw["thinking"]["type"] == "enabled"
    assert kw["thinking"]["budget_tokens"] == 8192
    assert kw["max_tokens"] == 8192 + 1024


def test_build_thinking_openai_effort():
    kw = build_thinking_client_kwargs(
        api_format="openai_chat",
        level="low",
        thinking_capable=True,
        max_tokens=4096,
    )
    assert kw["reasoning_effort"] == "low"
    assert kw["model_kwargs"]["extra_body"]["reasoning_effort"] == "low"


def test_list_baseline_includes_thinking_group():
    fields = list_baseline_fields()
    thinking = next(f for f in fields if f["field"] == "thinking_level")
    assert thinking["dimension"] == "thinking"
    assert thinking["group"] == "decode"
    dims = {f["dimension"] for f in fields if f.get("dimension")}
    assert "thinking" in dims


def test_thinking_dim_routes_levels(monkeypatch):
    """对比思考维时各列 thinking_level 不同。"""
    capable = LlmEndpoint(
        id="ep-think",
        label="Think",
        provider_name="X",
        api_key="k",
        base_url="https://example.com",
        model="m-think",
        thinking_capable=True,
        thinking_level="medium",
    )
    cfg = ProviderConfig(endpoints=[capable], default_endpoint_id="ep-think")
    monkeypatch.setattr("app.arena.router.load_provider_config", lambda: cfg)
    reset_dimension_options()
    sync_model_options_from_provider(cfg)

    r = DimensionRouter()
    configs = r.route(
        "thinking",
        selections=["off", "high"],
        baseline=BaselineOverrides(endpoint_id="ep-think"),
    )
    assert [c.thinking_level for c in configs] == ["off", "high"]
    assert all(c.thinking_capable for c in configs)
    assert all(c.endpoint_id == "ep-think" for c in configs)


def test_thinking_gated_when_incapable(monkeypatch):
    plain = LlmEndpoint(
        id="ep-plain",
        label="Plain",
        provider_name="X",
        api_key="k",
        base_url="https://example.com",
        model="m-plain",
        thinking_capable=False,
        thinking_level="high",
    )
    cfg = ProviderConfig(endpoints=[plain], default_endpoint_id="ep-plain")
    monkeypatch.setattr("app.arena.router.load_provider_config", lambda: cfg)
    reset_dimension_options()
    sync_model_options_from_provider(cfg)

    r = DimensionRouter()
    configs = r.route(
        "thinking",
        selections=["low", "high"],
        baseline=BaselineOverrides(endpoint_id="ep-plain"),
    )
    assert all(c.thinking_level == "off" for c in configs)
    assert all(c.thinking_capable is False for c in configs)


def test_effective_thinking_level_on_endpoint():
    ep = LlmEndpoint(
        id="e1",
        model="m",
        api_key="k",
        thinking_capable=False,
        thinking_level="high",
    )
    assert ep.effective_thinking_level("high") == "off"
    ep2 = LlmEndpoint(
        id="e2",
        model="m",
        api_key="k",
        thinking_capable=True,
        thinking_level="medium",
    )
    assert ep2.effective_thinking_level("high") == "high"
    assert ep2.effective_thinking_level("nope") == "off"
