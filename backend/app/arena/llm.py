"""LLM 客户端工厂 — Anthropic Messages 兼容 BYOK。"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic

from app.config import ProviderConfig, load_provider_config


def create_chat_model(config: ProviderConfig | None = None) -> ChatAnthropic:
    cfg = config or load_provider_config()
    if not cfg.api_key:
        raise ValueError("未配置 API Key，请先在 Settings 页面设置")

    return ChatAnthropic(
        model=cfg.model,
        api_key=cfg.api_key,
        base_url=cfg.base_url.rstrip("/"),
        temperature=cfg.temperature,
        max_tokens=cfg.max_output_tokens,
    )
