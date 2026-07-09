"""LLM 客户端工厂 — Anthropic Messages / OpenAI Chat 兼容 BYOK。"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from app.config import ProviderConfig, load_provider_config


def create_chat_model(config: ProviderConfig | None = None) -> ChatAnthropic | ChatOpenAI:
    """根据 api_format 创建对应的 LLM 客户端。"""
    cfg = config or load_provider_config()
    if not cfg.api_key:
        raise ValueError("未配置 API Key，请先在 Settings 页面设置")

    base_url = cfg.base_url.rstrip("/")

    if cfg.api_format == "openai_chat":
        return ChatOpenAI(
            model=cfg.model,
            api_key=cfg.api_key,
            base_url=base_url,
            temperature=cfg.temperature,
            max_tokens=cfg.max_output_tokens,
            timeout=30,
        )

    # 默认 anthropic_messages
    return ChatAnthropic(
        model=cfg.model,
        api_key=cfg.api_key,
        base_url=base_url,
        temperature=cfg.temperature,
        max_tokens=cfg.max_output_tokens,
        timeout=30,
    )
