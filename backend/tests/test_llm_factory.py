"""create_chat_model 按 api_format 分发 — Anthropic / OpenAI 路径覆盖。

当 ``langchain_openai`` 未安装时，仅 Anthropic 测试执行；OpenAI 测试用 pytest
条件跳过（保持开发环境轻量）。
"""

from __future__ import annotations

import pytest

from app.arena.llm import create_chat_model
from app.config import ProviderConfig

# 检测 langchain_openai 是否可用
try:
    import langchain_openai  # noqa: F401

    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

requires_openai = pytest.mark.skipif(not HAS_OPENAI, reason="langchain-openai 未安装")


def _anthropic_cfg() -> ProviderConfig:
    return ProviderConfig(
        provider_name="x",
        api_key="sk-test-anthropic",
        base_url="https://api.example.com",
        api_format="anthropic_messages",
        model="claude-test",
        max_output_tokens=64,
    )


def _openai_cfg() -> ProviderConfig:
    return ProviderConfig(
        provider_name="x",
        api_key="sk-test-openai",
        base_url="https://api.openai.com/v1",
        api_format="openai_chat",
        model="gpt-test",
        max_output_tokens=64,
        auth_field="Authorization",
    )


def test_create_anthropic_format():
    cfg = _anthropic_cfg()
    model = create_chat_model(cfg)
    # ChatAnthropic 暴露 anthropic_api_key
    assert hasattr(model, "anthropic_api_key")
    assert model.anthropic_api_key.get_secret_value() == "sk-test-anthropic"


@requires_openai
def test_create_openai_chat_format():
    cfg = _openai_cfg()
    model = create_chat_model(cfg)
    assert hasattr(model, "openai_api_key")
    assert model.openai_api_key.get_secret_value() == "sk-test-openai"


@requires_openai
def test_create_openai_chat_with_custom_auth_header():
    """auth_field 非 Authorization 时，通过 default_headers 注入。"""
    cfg = _openai_cfg()
    cfg.auth_field = "X-Custom-Auth"
    model = create_chat_model(cfg)
    headers = getattr(model, "default_headers", None) or {}
    assert headers.get("X-Custom-Auth") == "sk-test-openai"


def test_missing_api_key_raises():
    cfg = _anthropic_cfg()
    cfg.api_key = ""
    with pytest.raises(ValueError, match="API Key"):
        create_chat_model(cfg)


def test_openai_format_without_package_raises_runtime_error():
    """若 langchain_openai 缺失，openai 路径抛 RuntimeError。"""
    if HAS_OPENAI:
        pytest.skip("环境已安装 langchain-openai，跳过")
    cfg = _openai_cfg()
    with pytest.raises(RuntimeError, match="langchain-openai"):
        create_chat_model(cfg)


def test_anthropic_timeout_field_present():
    """timeout 必须显式配置，防止 LLM 卡死整条管线。"""
    model = create_chat_model(_anthropic_cfg())
    # ChatAnthropic 把 timeout 存到 ``default_request_timeout``
    timeout = getattr(model, "default_request_timeout", None)
    assert timeout is not None