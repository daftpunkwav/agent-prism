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
    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_cls.return_value = MagicMock()
        create_chat_model(config=_cfg(), temperature=0.7)
        kwargs = mock_cls.call_args.kwargs
        assert kwargs["temperature"] == 0.7
        assert kwargs["model"] == "m1"


def test_pipeline_contextvar_overrides_temperature():
    clear_pipeline_llm_overrides()
    set_pipeline_llm_overrides(temperature=0.55, model="pipeline-model")
    try:
        with patch("langchain_openai.ChatOpenAI") as mock_cls:
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


def test_contextvar_cleared_when_coroutine_cancelled():
    """CancelledError 路径下 finally 必须清空 ContextVar（PROGRESS §4.2.6）。

    模拟 adapter 在 await 中被客户端断开取消：finally 中的
    clear_pipeline_llm_overrides() 必须执行，不能把残留覆盖带到下次运行。
    """
    import asyncio

    from app.arena.llm import _pipeline_overrides

    async def adapter_like_run():
        set_pipeline_llm_overrides(temperature=0.55)
        try:
            # 模拟 LLM await 期间被取消
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise
        finally:
            clear_pipeline_llm_overrides()

    async def main():
        clear_pipeline_llm_overrides()
        task = asyncio.create_task(adapter_like_run())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # finally 已执行 → 覆盖参数被清空
        assert _pipeline_overrides.get() is None

    asyncio.run(main())


def test_adapters_clear_overrides_in_finally():
    """源码级契约：两个 adapter 的 finally 块必须调用 clear_pipeline_llm_overrides。"""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    for rel in ("backend/app/adapters/langgraph_adapter.py", "backend/app/adapters/langchain_adapter.py"):
        src = (root / rel).read_text(encoding="utf-8")
        assert "finally:" in src
        assert "clear_pipeline_llm_overrides()" in src
