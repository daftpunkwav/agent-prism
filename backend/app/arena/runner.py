"""并行运行池 — 调度 Adapter 并合并 SSE 事件。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from app.adapters.base import FrameworkAdapterRegistry
from app.adapters.langchain_adapter import LangChainAdapter
from app.adapters.langgraph_adapter import LangGraphAdapter
from app.arena.router import DimensionRouter
from app.models import ArenaEvent, ArenaRunRequest, PipelineConfig


def build_registry() -> FrameworkAdapterRegistry:
    registry = FrameworkAdapterRegistry()
    registry.register(LangChainAdapter())
    registry.register(LangGraphAdapter())
    return registry


class RunnerPool:
    def __init__(self, registry: FrameworkAdapterRegistry | None = None) -> None:
        self.registry = registry or build_registry()
        self.router = DimensionRouter()

    def configs_for(self, request: ArenaRunRequest) -> list[PipelineConfig]:
        configs = self.router.route(request.dimension)
        if request.temperature is not None:
            configs = [
                c.model_copy(update={"temperature": request.temperature}) for c in configs
            ]
        return configs

    async def stream_parallel(
        self, request: ArenaRunRequest
    ) -> AsyncIterator[ArenaEvent]:
        if not self.router.is_mvp_ready(request.dimension):
            yield ArenaEvent(
                type="error",
                pipeline="system",
                message=f"维度「{request.dimension}」将在后续版本开放，MVP 支持 framework / prompt",
            )
            return

        configs = self.configs_for(request)
        queue: asyncio.Queue[ArenaEvent | None] = asyncio.Queue()

        async def worker(cfg: PipelineConfig) -> None:
            try:
                async for event in self.registry.get(cfg.framework).run(
                    request.question, cfg
                ):
                    await queue.put(event)
            except Exception as exc:  # noqa: BLE001
                await queue.put(
                    ArenaEvent(
                        type="error",
                        pipeline=cfg.label,
                        message=str(exc),
                    )
                )
            finally:
                await queue.put(None)

        workers = [asyncio.create_task(worker(c)) for c in configs]
        finished = 0
        while finished < len(workers):
            item = await queue.get()
            if item is None:
                finished += 1
                continue
            yield item

        await asyncio.gather(*workers, return_exceptions=True)
