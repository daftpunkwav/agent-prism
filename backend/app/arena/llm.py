"""LLM 客户端工厂 — 按 ``api_format`` 分发，BYOK 配置驱动。

支持的格式：
- ``anthropic_messages``: ``ChatAnthropic``（Anthropic Messages 原生）
- ``openai_chat``: ``ChatOpenAI``（OpenAI Chat Completions 兼容 — 适用于
  StepFun、OpenRouter、绝大多数第三方代理）

``langchain_openai`` / ``openai`` 均为可选依赖；缺失时 ``api_format="openai_chat"``
会抛 ``ImportError``，其它路径不受影响。
"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel

from app.config import ProviderConfig, load_provider_config


def create_chat_model(config: ProviderConfig | None = None) -> BaseChatModel:
    """根据 ``cfg.api_format`` 返回对应的 LangChain ChatModel。"""
    cfg = config or load_provider_config()
    if not cfg.api_key:
        raise ValueError("未配置 API Key，请先在 Settings 页面设置")

    if cfg.api_format == "openai_chat":
        # 延迟导入：未安装 langchain_openai 时不影响 Anthropic 路径
        try:
            from langchain_openai import ChatOpenAI
        except ImportError as exc:
            raise RuntimeError(
                "api_format='openai_chat' 需要安装 langchain-openai"
            ) from exc
        default_headers: dict[str, str] = {}
        if cfg.auth_field and cfg.auth_field != "Authorization":
            default_headers[cfg.auth_field] = cfg.api_key
        return ChatOpenAI(
            model=cfg.model,
            api_key=cfg.api_key,
            base_url=cfg.base_url.rstrip("/"),
            temperature=cfg.temperature,
            max_tokens=cfg.max_output_tokens,
            timeout=120.0,
            max_retries=2,
            default_headers=default_headers or None,
        )

    # 默认 anthropic_messages
    return ChatAnthropic(
        model=cfg.model,
        api_key=cfg.api_key,
        base_url=cfg.base_url.rstrip("/"),
        temperature=cfg.temperature,
        max_tokens=cfg.max_output_tokens,
        timeout=120.0,
        max_retries=2,
    )