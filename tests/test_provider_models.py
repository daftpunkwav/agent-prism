"""多接入点配置与模型维度同步测试。"""

from __future__ import annotations

import pytest

from app.arena.router import (
    DIMENSION_OPTIONS,
    DimensionRouter,
    model_compare_ready,
    reset_dimension_options,
    sync_model_options_from_provider,
)
from app.config import (
    LlmEndpoint,
    ProviderConfig,
    merge_endpoint_keys,
    normalize_model_ids,
)


def test_normalize_model_ids_dedupes():
    assert normalize_model_ids("a", ["b", "a", " b ", ""]) == ["a", "b"]


def test_legacy_models_list_migrates_to_endpoints():
    cfg = ProviderConfig(model="step-3.7-flash", models=["step-2-mini", "step-1-8k"])
    assert len(cfg.endpoints) == 3
    assert [e.model for e in cfg.endpoints] == [
        "step-3.7-flash",
        "step-2-mini",
        "step-1-8k",
    ]
    assert all(e.base_url == cfg.endpoints[0].base_url for e in cfg.endpoints)


def test_same_connection_duplicate_model_raises():
    with pytest.raises(ValueError, match="重复"):
        ProviderConfig(
            endpoints=[
                LlmEndpoint(id="a", model="m1", base_url="https://api.example.com"),
                LlmEndpoint(id="b", model="m1", base_url="https://api.example.com"),
            ]
        )


def test_cross_provider_same_model_name_ok():
    cfg = ProviderConfig(
        endpoints=[
            LlmEndpoint(
                id="a",
                model="flash",
                base_url="https://a.example.com",
                api_format="openai_chat",
            ),
            LlmEndpoint(
                id="b",
                model="flash",
                base_url="https://b.example.com",
                api_format="openai_chat",
            ),
        ],
        default_endpoint_id="a",
    )
    assert len(cfg.endpoints) == 2


def test_sync_model_options_uses_endpoint_ids():
    reset_dimension_options()
    cfg = ProviderConfig(model="step-3.7-flash", models=["step-2-mini"])
    sync_model_options_from_provider(cfg)
    values = [v for _, v, _ in DIMENSION_OPTIONS["model"]]
    assert values == [e.id for e in cfg.endpoints]
    assert "gpt-4o" not in values
    assert model_compare_ready() is True


def test_sync_model_options_single_not_ready():
    reset_dimension_options()
    cfg = ProviderConfig(model="only-one", models=[])
    sync_model_options_from_provider(cfg)
    assert len(DIMENSION_OPTIONS["model"]) == 1
    assert model_compare_ready() is False


def test_comparison_model_ids_skips_duplicate_of_primary():
    cfg = ProviderConfig(model="m1", models=["m1", "m2"])
    assert cfg.comparison_model_ids() == ["m1", "m2"]


def test_route_model_unified_decode_params():
    """同连接两模型：endpoint/model 不同，temperature/top_p 相同。"""
    reset_dimension_options()
    cfg = ProviderConfig(
        model="m-a",
        models=["m-b"],
        temperature=0.7,
        top_p=0.9,
        max_output_tokens=2048,
    )
    sync_model_options_from_provider(cfg)
    configs = DimensionRouter().route("model")
    assert len(configs) == 2
    assert configs[0].endpoint_id != configs[1].endpoint_id
    assert configs[0].model_id != configs[1].model_id
    assert configs[0].temperature == configs[1].temperature == 0.7
    assert configs[0].top_p == configs[1].top_p == 0.9
    assert configs[0].max_output_tokens == configs[1].max_output_tokens == 2048


def test_route_model_cross_provider_different_urls():
    reset_dimension_options()
    cfg = ProviderConfig(
        endpoints=[
            LlmEndpoint(
                id="mini",
                label="MiniMax",
                model="m3",
                base_url="https://api.minimax.example/v1",
                api_format="openai_chat",
                api_key="k1",
            ),
            LlmEndpoint(
                id="ds",
                label="DeepSeek",
                model="v4-flash",
                base_url="https://api.deepseek.example/v1",
                api_format="openai_chat",
                api_key="k2",
            ),
        ],
        default_endpoint_id="mini",
        temperature=0,
        top_p=1,
    )
    sync_model_options_from_provider(cfg)
    configs = DimensionRouter().route("model")
    assert {c.endpoint_id for c in configs} == {"mini", "ds"}
    assert {c.model_id for c in configs} == {"m3", "v4-flash"}
    assert all(c.temperature == 0.0 for c in configs)
    assert all(c.top_p == 1.0 for c in configs)


def test_baseline_top_p_applies_to_all_model_lanes():
    reset_dimension_options()
    cfg = ProviderConfig(model="a", models=["b"], top_p=1.0)
    sync_model_options_from_provider(cfg)
    configs = DimensionRouter().route("model", baseline={"top_p": 0.8})
    assert all(c.top_p == 0.8 for c in configs)


def test_merge_endpoint_keys_inherits_same_connection():
    current = [
        LlmEndpoint(
            id="a",
            model="m1",
            base_url="https://api.example.com",
            api_key="secret",
            api_format="openai_chat",
        )
    ]
    incoming = [
        LlmEndpoint(
            id="a",
            model="m1",
            base_url="https://api.example.com",
            api_key="",
            api_format="openai_chat",
        ),
        LlmEndpoint(
            id="b",
            model="m2",
            base_url="https://api.example.com",
            api_key="",
            api_format="openai_chat",
        ),
    ]
    merged = merge_endpoint_keys(incoming, current)
    assert merged[0].api_key == "secret"
    assert merged[1].api_key == "secret"
