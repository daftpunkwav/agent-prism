"""并行运行池 — 调度 Adapter 并合并 SSE 事件。"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from app.adapters.base import AdapterReservedError, FrameworkAdapterRegistry
from app.adapters.langchain_adapter import LangChainAdapter
from app.adapters.langgraph_adapter import LangGraphAdapter
from app.arena.router import DimensionRouter
from app.models import ArenaEvent, ArenaRunRequest, PipelineConfig

logger = logging.getLogger(__name__)


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
        configs = self.router.route(request.dimension, request.selections)
        if request.temperature is not None:
            configs = [c.model_copy(update={"temperature": request.temperature}) for c in configs]
        return configs

    async def stream_parallel(
        self,
        request: ArenaRunRequest,
        on_cancel: AsyncIterator[None] | None = None,
    ) -> AsyncIterator[ArenaEvent]:
        try:
            configs = self.configs_for(request)
        except ValueError as exc:
            # 维度名未知或不支持 — 单一错误事件后退出
            yield ArenaEvent(
                type="error",
                pipeline="system",
                message=str(exc),
            )
            return

        queue: asyncio.Queue[ArenaEvent | None] = asyncio.Queue()

        async def worker(cfg: PipelineConfig) -> None:
            try:
                async for event in self.registry.get(cfg.framework).run(request.question, cfg):
                    await queue.put(event)
            except asyncio.CancelledError:
                # 客户端断开 — 静默传播
                raise
            except AdapterReservedError as exc:
                await queue.put(
                    ArenaEvent(
                        type="error",
                        pipeline=cfg.label,
                        message=f"框架「{exc.framework_id}」尚未实现",
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Pipeline %s 失败", cfg.label)
                # 仅暴露异常类型名而非详细消息，避免泄露 provider 内部细节
                await queue.put(
                    ArenaEvent(
                        type="error",
                        pipeline=cfg.label,
                        message=f"{type(exc).__name__}: {str(exc)[:200]}",
                    )
                )
            finally:
                await queue.put(None)

        workers = [asyncio.create_task(worker(c)) for c in configs]
        finished = 0
        try:
            while finished < len(workers):
                item = await queue.get()
                if item is None:
                    finished += 1
                    continue
                yield item
        except asyncio.CancelledError:
            # 客户端断开 — 取消所有 worker 并等待它们结束
            for w in workers:
                if not w.done():
                    w.cancel()
            # 等待所有 worker 完成清理
            await asyncio.gather(*workers, return_exceptions=True)
            raise
        finally:
            # 确保所有 worker 都被取消
            for w in workers:
                if not w.done():
                    w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
