"""Pipeline LLM 覆盖参数（ContextVar）回归。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.arena.llm import (
    clear_pipeline_llm_overrides,
    create_chat_model,
    set_pipeline_llm_overrides,
)
from app.config import ProviderConfig


def _cfg(**kwargs) -> ProviderConfig:
    base = dict(
        provider_name="t",
        api_key="sk-test",
        base_url="https://example.com",
        api_format="openai_chat",
        model="m1",
        temperature=0.1,
        top_p=0.9,
        frequency_penalty=0.0,
        presence_penalty=0.0,
        max_output_tokens=100,
    )
    base.update(kwargs)
    return ProviderConfig(**base)


def test_explicit_temperature_overrides_provider():
    clear_pipeline_llm_overrides()
    with patch("app.arena.llm.ChatOpenAI") as mock_cls:
        mock_cls.return_value = MagicMock()
        create_chat_model(config=_cfg(), temperature=0.7)
        kwargs = mock_cls.call_args.kwargs
        assert kwargs["temperature"] == 0.7
        assert kwargs["model"] == "m1"


def test_pipeline_contextvar_overrides_temperature():
    clear_pipeline_llm_overrides()
    set_pipeline_llm_overrides(temperature=0.55, model="pipeline-model")
    try:
        with patch("app.arena.llm.ChatOpenAI") as mock_cls:
            mock_cls.return_value = MagicMock()
            create_chat_model(config=_cfg())
            kwargs = mock_cls.call_args.kwargs
            assert kwargs["temperature"] == 0.55
            assert kwargs["model"] == "pipeline-model"
    finally:
        clear_pipeline_llm_overrides()


def test_missing_api_key_raises():
    clear_pipeline_llm_overrides()
    with pytest.raises(ValueError, match="API Key"):
        create_chat_model(config=_cfg(api_key=""))
