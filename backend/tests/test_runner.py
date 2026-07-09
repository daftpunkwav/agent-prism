"""RunnerPool 单元测试 — SSE 取消时 worker 必须被回收。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from app.adapters.base import FrameworkAdapterRegistry
from app.arena.router import DimensionRouter
from app.arena.runner import RunnerPool
from app.models import ArenaEvent, ArenaRunRequest, PipelineConfig


def _make_adapter(framework_id: str, behaviour):
    """工厂：构造一个 stub adapter，framework_id 唯一，run 委托给 behaviour。"""
    adapter = type(
        f"Stub_{framework_id}",
        (),
        {
            "framework_id": framework_id,
            "display_name": framework_id.upper(),
            "run": lambda self, question, config: behaviour(config),
        },
    )()
    return adapter


def _make_pool(adapter_a, adapter_b, monkeypatch) -> RunnerPool:
    """注册两个 adapter（不同 framework_id），构造 RunnerPool。

    Router 的 ``DIMENSION_OPTIONS`` 是模块级 dict，所以通过 monkeypatch 修改。
    """
    registry = FrameworkAdapterRegistry()
    registry.register(adapter_a)
    registry.register(adapter_b)
    # Router 读模块级 DIMENSION_OPTIONS — 替换为只含我们两个 adapter 的视图
    from app.arena import router as router_module

    monkeypatch.setattr(
        router_module,
        "DIMENSION_OPTIONS",
        {
            "framework": [
                ("framework", adapter_a.framework_id, adapter_a.display_name),
                ("framework", adapter_b.framework_id, adapter_b.display_name),
            ],
            "prompt": [("prompt_profile", "zero_shot", "Zero-shot")],
            "reasoning": [("reasoning", "react", "ReAct")],
            "context": [("context", "sliding", "Sliding")],
            "harness": [("harness", "bare", "Bare")],
        },
    )
    pool = RunnerPool.__new__(RunnerPool)
    pool.registry = registry
    pool.router = DimensionRouter()
    return pool


async def _hang(config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
    """无限 yield — 用于测试取消路径。"""
    try:
        i = 0
        while True:
            yield ArenaEvent(type="thought_delta", pipeline=config.label, content=str(i))
            i += 1
            await asyncio.sleep(0.05)
    except asyncio.CancelledError:
        raise


def _drain_async(agen: AsyncIterator[ArenaEvent], max_events: int | None = None) -> list[ArenaEvent]:
    """同步驱动一个 async generator；可选 max_events 提前退出。"""
    events: list[ArenaEvent] = []
    loop = asyncio.new_event_loop()
    try:
        while True:
            if max_events is not None and len(events) >= max_events:
                break
            try:
                events.append(loop.run_until_complete(agen.__anext__()))
            except StopAsyncIteration:
                break
    finally:
        try:
            loop.run_until_complete(agen.aclose())
        except Exception:
            pass
        loop.close()
    return events


def test_stream_parallel_unknown_dimension_yields_single_error(monkeypatch):
    """未知维度 → 单个 error 事件后退出，不抛异常。"""
    pool = RunnerPool(FrameworkAdapterRegistry())
    # 绕开 Pydantic Literal 校验：直接构造 model 后篡改 dimension
    req = ArenaRunRequest(question="x", dimension="framework")
    object.__setattr__(req, "dimension", "bogus")
    events = _drain_async(pool.stream_parallel(req))
    assert len(events) == 1
    assert events[0].type == "error"
    assert "bogus" in events[0].message


def test_worker_exception_becomes_error_event(monkeypatch):
    """worker 内部异常被收敛为 SSE error 事件，不让 stream 崩。"""

    async def boom(config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        raise RuntimeError("boom-internal")
        yield ArenaEvent(type="complete", pipeline=config.label)  # noqa: unreachable

    a = _make_adapter("boom-a", boom)
    b = _make_adapter("boom-b", boom)
    pool = _make_pool(a, b, monkeypatch)

    req = ArenaRunRequest(question="x", dimension="framework", selections=["boom-a", "boom-b"])
    events = _drain_async(pool.stream_parallel(req))

    errors = [ev for ev in events if ev.type == "error"]
    assert errors
    assert "boom-internal" in errors[0].message
    assert "Traceback" not in errors[0].message


def test_cancellation_propagates_to_workers(monkeypatch):
    """客户端断开 → 内部 worker task 被取消，无残留任务。"""

    cancelled: list[str] = []

    async def track(config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        try:
            i = 0
            while True:
                yield ArenaEvent(type="thought_delta", pipeline=config.label, content=str(i))
                i += 1
                await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            cancelled.append(config.label)
            raise

    a = _make_adapter("hang-a", track)
    b = _make_adapter("hang-b", track)
    pool = _make_pool(a, b, monkeypatch)
    req = ArenaRunRequest(question="x", dimension="framework", selections=["hang-a", "hang-b"])

    # 只消费 1 个事件，然后 aclose() 触发 CancelledError；
    # runner 内部应该捕获并 task.cancel() 所有 worker
    _drain_async(pool.stream_parallel(req), max_events=1)

    assert cancelled, "worker 应该被取消"