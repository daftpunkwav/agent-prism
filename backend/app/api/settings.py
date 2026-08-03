"""BYOK Provider 设置 API。"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.arena.router import invalidate_provider_cache
from app.config import (
    LlmEndpoint,
    ProviderConfig,
    load_provider_config,
    merge_endpoint_keys,
    new_endpoint_id,
    save_provider_config,
)
from app.models import (
    ConnectionTestResult,
    LlmEndpointPublic,
    LlmEndpointUpdate,
    ProviderConfigPublic,
    ProviderConfigUpdate,
)

try:
    import anthropic
except ImportError:  # 测连时再报错；单元测试可 patch 本模块 anthropic.Anthropic
    from types import SimpleNamespace

    anthropic = SimpleNamespace(Anthropic=None)  # type: ignore[assignment]

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _mask_key(key: str) -> str:
    """脱敏 API Key。短 Key 统一显示 ``<short>``，避免长度泄露。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "<short>"
    return f"{key[:4]}...{key[-4:]}"


def _endpoint_public(ep: LlmEndpoint) -> LlmEndpointPublic:
    return LlmEndpointPublic(
        id=ep.id,
        label=ep.label,
        provider_name=ep.provider_name,
        api_key_set=bool(ep.api_key),
        api_key_preview=_mask_key(ep.api_key),
        base_url=ep.base_url,
        use_full_url=ep.use_full_url,
        api_format=ep.api_format,
        auth_field=ep.auth_field,
        model=ep.model,
        context_window=ep.context_window,
        max_input_tokens=ep.max_input_tokens,
        max_output_tokens=ep.max_output_tokens,
        website_url=ep.website_url,
        thinking_capable=ep.thinking_capable,
        thinking_level=ep.thinking_level,
    )


def _to_public(cfg: ProviderConfig) -> ProviderConfigPublic:
    default = cfg.default_endpoint()
    return ProviderConfigPublic(
        notes=cfg.notes,
        website_url=cfg.website_url,
        endpoints=[_endpoint_public(e) for e in cfg.endpoints],
        default_endpoint_id=cfg.default_endpoint_id,
        temperature=cfg.temperature,
        top_p=cfg.top_p,
        frequency_penalty=cfg.frequency_penalty,
        presence_penalty=cfg.presence_penalty,
        max_output_tokens=cfg.max_output_tokens,
        provider_name=default.provider_name,
        api_key_set=bool(default.api_key),
        api_key_preview=_mask_key(default.api_key),
        base_url=default.base_url,
        use_full_url=default.use_full_url,
        api_format=default.api_format,
        auth_field=default.auth_field,
        model=default.model,
        models=list(cfg.models),
        context_window=default.context_window,
        max_input_tokens=default.max_input_tokens,
    )


def _update_to_endpoints(body: ProviderConfigUpdate, current: ProviderConfig) -> list[LlmEndpoint]:
    """从更新体构建接入点列表（含空 key 保留）。"""
    if body.endpoints:
        incoming: list[LlmEndpoint] = []
        for item in body.endpoints:
            eid = (item.id or "").strip() or new_endpoint_id()
            data = item.model_dump()
            data["id"] = eid
            if not data.get("base_url"):
                data["base_url"] = current.base_url
            incoming.append(LlmEndpoint(**data))
        return merge_endpoint_keys(incoming, current.endpoints)

    # 旧客户端：顶层字段 + models[]
    primary_id = current.default_endpoint_id or new_endpoint_id()
    api_key = body.api_key or current.api_key
    primary = LlmEndpoint(
        id=primary_id,
        label="",
        provider_name=body.provider_name,
        api_key=api_key,
        base_url=body.base_url or current.base_url,
        use_full_url=body.use_full_url,
        api_format=body.api_format,
        auth_field=body.auth_field,
        model=body.model,
        context_window=body.context_window,
        max_input_tokens=body.max_input_tokens,
        max_output_tokens=body.max_output_tokens,
        website_url=body.website_url or "",
    )
    endpoints = [primary]
    for mid in body.models or []:
        if mid == primary.model:
            continue
        endpoints.append(
            LlmEndpoint(
                id=new_endpoint_id(),
                label=mid,
                provider_name=primary.provider_name,
                api_key=api_key,
                base_url=primary.base_url,
                use_full_url=primary.use_full_url,
                api_format=primary.api_format,
                auth_field=primary.auth_field,
                model=mid,
                context_window=primary.context_window,
                max_input_tokens=primary.max_input_tokens,
                max_output_tokens=primary.max_output_tokens,
                website_url=primary.website_url,
            )
        )
    return endpoints


@router.get("/provider", response_model=ProviderConfigPublic)
async def get_provider() -> ProviderConfigPublic:
    return _to_public(load_provider_config())


@router.put("/provider", response_model=ProviderConfigPublic)
async def update_provider(body: ProviderConfigUpdate) -> ProviderConfigPublic:
    current = load_provider_config()
    try:
        endpoints = _update_to_endpoints(body, current)
        default_id = body.default_endpoint_id or current.default_endpoint_id
        if default_id not in {e.id for e in endpoints}:
            default_id = endpoints[0].id
        config = ProviderConfig(
            notes=body.notes,
            website_url=body.website_url,
            endpoints=endpoints,
            default_endpoint_id=default_id,
            temperature=body.temperature,
            top_p=body.top_p,
            frequency_penalty=body.frequency_penalty,
            presence_penalty=body.presence_penalty,
            max_output_tokens=body.max_output_tokens,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_provider_config(config)
    invalidate_provider_cache()
    return _to_public(config)


@router.post("/provider/test", response_model=ConnectionTestResult)
async def test_provider(body: ProviderConfigUpdate | None = None) -> ConnectionTestResult:
    """测试 Provider / 指定接入点连接。"""
    current = load_provider_config()
    if body is None:
        ep = current.default_endpoint()
    elif body.test_endpoint_id and body.endpoints:
        # 优先测 body 中指定接入点
        match = next((e for e in body.endpoints if e.id == body.test_endpoint_id), None)
        if match is None:
            raise HTTPException(status_code=400, detail="未找到要测试的接入点")
        ep = _endpoint_update_to_runtime(match, current)
    elif body.test_endpoint_id:
        found = current.get_endpoint(body.test_endpoint_id)
        if not found:
            raise HTTPException(status_code=400, detail="未找到要测试的接入点")
        ep = found
    elif body.endpoints:
        first = body.endpoints[0]
        ep = _endpoint_update_to_runtime(first, current)
    else:
        # 旧扁平测连
        api_key = body.api_key or current.api_key
        ep = LlmEndpoint(
            id="test",
            provider_name=body.provider_name,
            api_key=api_key,
            base_url=body.base_url or current.base_url,
            use_full_url=body.use_full_url,
            api_format=body.api_format,
            auth_field=body.auth_field,
            model=body.model,
        )

    if not ep.api_key:
        raise HTTPException(status_code=400, detail="请先填写 API Key")

    if ep.api_format == "openai_chat":
        return await _test_openai(ep)
    return await _test_anthropic(ep)


def _endpoint_update_to_runtime(
    item: LlmEndpointUpdate, current: ProviderConfig
) -> LlmEndpoint:
    """测连用：空 key 从已存同 id 或默认接入点补齐。"""
    eid = (item.id or "").strip()
    key = item.api_key
    if not key and eid:
        prev = current.get_endpoint(eid)
        if prev:
            key = prev.api_key
    if not key:
        key = current.default_endpoint().api_key
    return LlmEndpoint(
        id=eid or new_endpoint_id(),
        label=item.label,
        provider_name=item.provider_name,
        api_key=key,
        base_url=item.base_url or current.base_url,
        use_full_url=item.use_full_url,
        api_format=item.api_format,
        auth_field=item.auth_field,
        model=item.model,
        context_window=item.context_window,
        max_input_tokens=item.max_input_tokens,
        max_output_tokens=item.max_output_tokens,
        website_url=item.website_url or "",
        thinking_capable=item.thinking_capable,
        thinking_level=item.thinking_level,
    )


async def _test_anthropic(ep: LlmEndpoint) -> ConnectionTestResult:
    return await asyncio.to_thread(_test_anthropic_sync, ep)


def _test_anthropic_sync(ep: LlmEndpoint) -> ConnectionTestResult:
    try:
        client = anthropic.Anthropic(
            api_key=ep.api_key,
            base_url=ep.base_url.rstrip("/"),
        )
        msg = client.messages.create(
            model=ep.model,
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
            model=ep.model,
        )
    except Exception as exc:  # noqa: BLE001
        return ConnectionTestResult(
            ok=False,
            message=f"连接失败: {type(exc).__name__}",
            model=ep.model,
        )


async def _test_openai(ep: LlmEndpoint) -> ConnectionTestResult:
    return await asyncio.to_thread(_test_openai_sync, ep)


def _test_openai_sync(ep: LlmEndpoint) -> ConnectionTestResult:
    try:
        import openai

        default_headers: dict[str, str] = {}
        if ep.auth_field and ep.auth_field != "Authorization":
            default_headers[ep.auth_field] = ep.api_key
        client = openai.OpenAI(
            api_key=ep.api_key,
            base_url=ep.base_url.rstrip("/"),
            default_headers=default_headers or None,
        )
        resp = client.chat.completions.create(
            model=ep.model,
            max_tokens=32,
            messages=[{"role": "user", "content": "ping"}],
        )
        snippet = ""
        if resp.choices:
            snippet = resp.choices[0].message.content or ""
        return ConnectionTestResult(
            ok=True,
            message=f"连接成功: {snippet[:80] or 'ok'}",
            model=ep.model,
        )
    except Exception as exc:  # noqa: BLE001
        return ConnectionTestResult(
            ok=False,
            message=f"连接失败: {type(exc).__name__}",
            model=ep.model,
        )
