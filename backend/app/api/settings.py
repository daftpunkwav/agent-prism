"""BYOK Provider 设置 API。"""

from __future__ import annotations

import anthropic
from fastapi import APIRouter, HTTPException

from app.arena.router import invalidate_provider_cache
from app.config import ProviderConfig, load_provider_config, save_provider_config
from app.models import (
    ConnectionTestResult,
    ProviderConfigPublic,
    ProviderConfigUpdate,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _mask_key(key: str) -> str:
    """脱敏 API Key。短 Key 统一显示 ``<short>``，避免长度泄露。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "<short>"
    return f"{key[:4]}...{key[-4:]}"


def _to_public(cfg: ProviderConfig) -> ProviderConfigPublic:
    return ProviderConfigPublic(
        provider_name=cfg.provider_name,
        notes=cfg.notes,
        website_url=cfg.website_url,
        api_key_set=bool(cfg.api_key),
        api_key_preview=_mask_key(cfg.api_key),
        base_url=cfg.base_url,
        use_full_url=cfg.use_full_url,
        api_format=cfg.api_format,
        auth_field=cfg.auth_field,
        model=cfg.model,
        temperature=cfg.temperature,
        top_p=cfg.top_p,
        frequency_penalty=cfg.frequency_penalty,
        presence_penalty=cfg.presence_penalty,
        context_window=cfg.context_window,
        max_input_tokens=cfg.max_input_tokens,
        max_output_tokens=cfg.max_output_tokens,
    )


@router.get("/provider", response_model=ProviderConfigPublic)
async def get_provider() -> ProviderConfigPublic:
    return _to_public(load_provider_config())


@router.put("/provider", response_model=ProviderConfigPublic)
async def update_provider(body: ProviderConfigUpdate) -> ProviderConfigPublic:
    current = load_provider_config()
    data = body.model_dump()
    if not data.get("api_key"):
        data["api_key"] = current.api_key
    config = ProviderConfig(**data)
    save_provider_config(config)
    # Provider 配置更新后，失效 router 缓存以避免使用旧 model/temperature
    invalidate_provider_cache()
    return _to_public(config)


@router.post("/provider/test", response_model=ConnectionTestResult)
async def test_provider(body: ProviderConfigUpdate | None = None) -> ConnectionTestResult:
    """测试 Provider 连接。

    按 ``cfg.api_format`` 分发：
    - ``anthropic_messages``: ``anthropic.Anthropic``
    - ``openai_chat``: ``openai.OpenAI`` Chat Completions
    """
    cfg = ProviderConfig(**(body.model_dump() if body else load_provider_config().model_dump()))
    if body and not body.api_key:
        cfg.api_key = load_provider_config().api_key
    if not cfg.api_key:
        raise HTTPException(status_code=400, detail="请先填写 API Key")

    if cfg.api_format == "openai_chat":
        return await _test_openai(cfg)
    return await _test_anthropic(cfg)


async def _test_anthropic(cfg: ProviderConfig) -> ConnectionTestResult:
    try:
        client = anthropic.Anthropic(
            api_key=cfg.api_key,
            base_url=cfg.base_url.rstrip("/"),
        )
        msg = client.messages.create(
            model=cfg.model,
            max_tokens=32,
            messages=[{"role": "user", "content": "ping"}],
        )
        snippet = ""
        for block in msg.content:
            text = getattr(block, "text", None)
            if text:
                snippet = text
                break
            thinking = getattr(block, "thinking", None)
            if thinking:
                snippet = str(thinking)[:80]
                break
        return ConnectionTestResult(
            ok=True,
            message=f"连接成功: {snippet or 'ok'}",
            model=cfg.model,
        )
    except Exception as exc:  # noqa: BLE001
        return ConnectionTestResult(
            ok=False,
            message=f"连接失败: {type(exc).__name__}",
            model=cfg.model,
        )


async def _test_openai(cfg: ProviderConfig) -> ConnectionTestResult:
    try:
        # 延迟导入 openai — 避免强依赖（部分用户只用 Anthropic）
        import openai

        default_headers: dict[str, str] = {}
        if cfg.auth_field and cfg.auth_field != "Authorization":
            default_headers[cfg.auth_field] = cfg.api_key
        client = openai.OpenAI(
            api_key=cfg.api_key,
            base_url=cfg.base_url.rstrip("/"),
            default_headers=default_headers or None,
        )
        resp = client.chat.completions.create(
            model=cfg.model,
            max_tokens=32,
            messages=[{"role": "user", "content": "ping"}],
        )
        snippet = ""
        if resp.choices:
            snippet = resp.choices[0].message.content or ""
        return ConnectionTestResult(
            ok=True,
            message=f"连接成功: {snippet[:80] or 'ok'}",
            model=cfg.model,
        )
    except Exception as exc:  # noqa: BLE001
        return ConnectionTestResult(
            ok=False,
            message=f"连接失败: {type(exc).__name__}",
            model=cfg.model,
        )
