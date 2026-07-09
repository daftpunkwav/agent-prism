"""BYOK Provider 设置 API。"""

from __future__ import annotations

import anthropic
from fastapi import APIRouter, HTTPException

from app.config import ProviderConfig, load_provider_config, save_provider_config
from app.models import (
    ConnectionTestResult,
    ProviderConfigPublic,
    ProviderConfigUpdate,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
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
    return _to_public(config)


@router.post("/provider/test", response_model=ConnectionTestResult)
async def test_provider(body: ProviderConfigUpdate | None = None) -> ConnectionTestResult:
    cfg = ProviderConfig(**(body.model_dump() if body else load_provider_config().model_dump()))
    if body and not body.api_key:
        cfg.api_key = load_provider_config().api_key
    if not cfg.api_key:
        raise HTTPException(status_code=400, detail="请先填写 API Key")

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
        # 仅返回异常类型与简短消息，避免在响应中泄露完整 endpoint/堆栈
        return ConnectionTestResult(
            ok=False,
            message=f"连接失败: {type(exc).__name__}",
            model=cfg.model,
        )
