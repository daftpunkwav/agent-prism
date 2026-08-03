"""LLM 客户端工厂 — 按 ``api_format`` 分发，BYOK 配置驱动。

支持的格式：
- ``anthropic_messages``: ``ChatAnthropic``（Anthropic Messages 原生）
- ``openai_chat``: ``ChatOpenAI``（OpenAI Chat Completions 兼容 — 适用于
  StepFun、OpenRouter、绝大多数第三方代理）

``langchain_openai`` / ``openai`` / ``langchain_anthropic`` 均为延迟导入；
缺失时对应路径会抛 ``RuntimeError``，其它路径不受影响。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.config import ProviderConfig, load_provider_config

# Pipeline 级覆盖（temperature / model 等），按异步任务隔离
_pipeline_overrides: ContextVar[dict[str, Any] | None] = ContextVar(
    "llm_pipeline_overrides", default=None
)


def set_pipeline_llm_overrides(**kwargs: Any) -> None:
    """设置当前任务的 LLM 覆盖参数（如 temperature、model）。"""
    current = dict(_pipeline_overrides.get() or {})
    current.update({k: v for k, v in kwargs.items() if v is not None})
    _pipeline_overrides.set(current)


def clear_pipeline_llm_overrides() -> None:
    _pipeline_overrides.set(None)


def create_chat_model(
    config: ProviderConfig | None = None,
    *,
    temperature: float | None = None,
    model: str | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
) -> BaseChatModel:
    """根据 api_format 创建对应的 LLM 客户端。

    优先级：显式参数 > pipeline overrides（ContextVar）> ProviderConfig。
    """
    cfg = config or load_provider_config()
    if not cfg.api_key:
        raise ValueError("未配置 API Key，请先在 Settings 页面设置")

    overrides = _pipeline_overrides.get() or {}

    base_url = cfg.base_url.rstrip("/")
    resolved_model = model or overrides.get("model") or cfg.model

    def _pick(explicit: Any, key: str, default: Any) -> Any:
        if explicit is not None:
            return explicit
        if key in overrides:
            return overrides[key]
        return default

    resolved_temp = _pick(temperature, "temperature", cfg.temperature)
    resolved_max = _pick(max_tokens, "max_tokens", cfg.max_output_tokens)
    resolved_top_p = _pick(top_p, "top_p", cfg.top_p)
    resolved_freq = _pick(frequency_penalty, "frequency_penalty", cfg.frequency_penalty)
    resolved_pres = _pick(presence_penalty, "presence_penalty", cfg.presence_penalty)

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
        kwargs: dict[str, Any] = {
            "model": resolved_model,
            "api_key": cfg.api_key,
            "base_url": base_url,
            "temperature": resolved_temp,
            "max_tokens": resolved_max,
            "timeout": 120.0,
            "max_retries": 2,
        }
        if default_headers:
            kwargs["default_headers"] = default_headers
        if resolved_top_p is not None:
            kwargs["top_p"] = resolved_top_p
        if resolved_freq is not None:
            kwargs["frequency_penalty"] = resolved_freq
        if resolved_pres is not None:
            kwargs["presence_penalty"] = resolved_pres
        return ChatOpenAI(**kwargs)

    # 默认 anthropic_messages — 延迟导入，避免模块 import 时强依赖
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as exc:
        raise RuntimeError(
            "api_format='anthropic_messages' 需要安装 langchain-anthropic"
        ) from exc
    anthropic_kwargs: dict[str, Any] = {
        "model": resolved_model,
        "api_key": cfg.api_key,
        "base_url": base_url,
        "temperature": resolved_temp,
        "max_tokens": resolved_max,
        "timeout": 120.0,
        "max_retries": 2,
    }
    if resolved_top_p is not None:
        anthropic_kwargs["top_p"] = resolved_top_p
    return ChatAnthropic(**anthropic_kwargs)
