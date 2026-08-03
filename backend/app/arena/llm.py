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

from app.config import LlmEndpoint, ProviderConfig, load_provider_config

# Pipeline 级覆盖（连接 + 解码），按异步任务隔离
_pipeline_overrides: ContextVar[dict[str, Any] | None] = ContextVar(
    "llm_pipeline_overrides", default=None
)


def set_pipeline_llm_overrides(**kwargs: Any) -> None:
    """设置当前任务的 LLM 覆盖参数（连接与解码均可）。"""
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
    endpoint: LlmEndpoint | None = None,
) -> BaseChatModel:
    """根据 api_format 创建对应的 LLM 客户端。

    优先级：显式参数 > pipeline overrides（ContextVar）> endpoint / ProviderConfig。
    """
    cfg = config or load_provider_config()
    overrides = _pipeline_overrides.get() or {}

    def _pick(explicit: Any, key: str, default: Any) -> Any:
        if explicit is not None:
            return explicit
        if key in overrides:
            return overrides[key]
        return default

    # 连接：显式 endpoint / overrides.endpoint_id → 接入点；否则用顶层镜像（兼容旧调用）
    use_endpoint_connection = endpoint is not None or bool(overrides.get("endpoint_id"))
    if endpoint is not None:
        ep = endpoint
    elif overrides.get("endpoint_id"):
        ep = cfg.resolve_endpoint(str(overrides["endpoint_id"]))
    else:
        ep = cfg.default_endpoint()

    if use_endpoint_connection:
        api_key = _pick(None, "api_key", ep.api_key)
        base_url = str(_pick(None, "base_url", ep.base_url)).rstrip("/")
        api_format = _pick(None, "api_format", ep.api_format)
        auth_field = _pick(None, "auth_field", ep.auth_field)
        default_model = ep.model
    else:
        api_key = _pick(None, "api_key", cfg.api_key)
        base_url = str(_pick(None, "base_url", cfg.base_url)).rstrip("/")
        api_format = _pick(None, "api_format", cfg.api_format)
        auth_field = _pick(None, "auth_field", cfg.auth_field)
        default_model = cfg.model

    if not api_key:
        raise ValueError("未配置 API Key，请先在 Settings 页面设置")

    from app.arena.url_validate import UrlValidationError, validate_llm_base_url

    try:
        validate_llm_base_url(base_url)
    except UrlValidationError as exc:
        raise ValueError(str(exc)) from exc

    resolved_model = model or overrides.get("model") or default_model
    resolved_temp = _pick(temperature, "temperature", cfg.temperature)
    resolved_max = int(_pick(max_tokens, "max_tokens", cfg.max_output_tokens))
    resolved_top_p = _pick(top_p, "top_p", cfg.top_p)
    resolved_freq = _pick(frequency_penalty, "frequency_penalty", cfg.frequency_penalty)
    resolved_pres = _pick(presence_penalty, "presence_penalty", cfg.presence_penalty)

    from app.arena.thinking import build_thinking_client_kwargs

    thinking_capable = bool(
        _pick(None, "thinking_capable", getattr(ep, "thinking_capable", False))
    )
    thinking_level = str(
        _pick(None, "thinking_level", getattr(ep, "thinking_level", "off") or "off")
    )
    think_kw = build_thinking_client_kwargs(
        api_format=str(api_format),
        level=thinking_level,
        thinking_capable=thinking_capable,
        max_tokens=resolved_max,
    )
    if "max_tokens" in think_kw:
        resolved_max = int(think_kw.pop("max_tokens"))

    if api_format == "openai_chat":
        try:
            from langchain_openai import ChatOpenAI
        except ImportError as exc:
            raise RuntimeError(
                "api_format='openai_chat' 需要安装 langchain-openai"
            ) from exc
        default_headers: dict[str, str] = {}
        if auth_field and auth_field != "Authorization":
            default_headers[str(auth_field)] = str(api_key)
        kwargs: dict[str, Any] = {
            "model": resolved_model,
            "api_key": api_key,
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
        # reasoning_effort / model_kwargs
        if "reasoning_effort" in think_kw:
            kwargs["reasoning_effort"] = think_kw["reasoning_effort"]
        if "model_kwargs" in think_kw:
            kwargs["model_kwargs"] = think_kw["model_kwargs"]
        return ChatOpenAI(**kwargs)

    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as exc:
        raise RuntimeError(
            "api_format='anthropic_messages' 需要安装 langchain-anthropic"
        ) from exc
    anthropic_kwargs: dict[str, Any] = {
        "model": resolved_model,
        "api_key": api_key,
        "base_url": base_url,
        "temperature": resolved_temp,
        "max_tokens": resolved_max,
        "timeout": 120.0,
        "max_retries": 2,
    }
    if resolved_top_p is not None:
        anthropic_kwargs["top_p"] = resolved_top_p
    if "thinking" in think_kw:
        anthropic_kwargs["thinking"] = think_kw["thinking"]
    return ChatAnthropic(**anthropic_kwargs)
