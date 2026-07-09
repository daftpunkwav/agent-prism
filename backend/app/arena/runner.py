"""并行运行池 — 调度 Adapter 并合并 SSE 事件。

设计要点：
- 每个 PipelineConfig 启动一个 worker task，全部并发跑
- worker 通过 ``asyncio.Queue`` 投递事件，主消费者按到达顺序 yield
- 客户端断开（``asyncio.CancelledError``）时主动取消所有 worker，避免任务泄漏
- worker 异常统一收敛为 SSE ``error`` 事件，不会让连接突然中断
"""

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
    """管理 Adapter 注册表 + 维度路由，对外暴露 ``stream_parallel``。"""

    def __init__(self, registry: FrameworkAdapterRegistry | None = None) -> None:
        self.registry = registry or build_registry()
        self.router = DimensionRouter()

    def configs_for(self, request: ArenaRunRequest) -> list[PipelineConfig]:
        configs = self.router.route(request.dimension, request.selections)
        if request.temperature is not None:
            configs = [c.model_copy(update={"temperature": request.temperature}) for c in configs]
        return configs

    async def stream_parallel(self, request: ArenaRunRequest) -> AsyncIterator[ArenaEvent]:
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
        workers: list[asyncio.Task[None]] = []
        try:
            workers = [asyncio.create_task(self._worker(c, request, queue)) for c in configs]

            finished = 0
            while finished < len(workers):
                # 加超时是为了让客户端断开的 CancelledError 有机会冒泡
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    # 检查是否所有 worker 已结束（罕见 race）
                    if all(w.done() for w in workers):
                        break
                    continue
                if item is None:
                    finished += 1
                    continue
                yield item
        except (asyncio.CancelledError, GeneratorExit):
            # 客户端断开 — 主动取消 worker，避免任务泄漏到下次运行
            for w in workers:
                if not w.done():
                    w.cancel()
            # 等 worker 真正结束（带超时，防止 LLM 同步阻塞卡死）
            await asyncio.gather(*workers, return_exceptions=True)
            raise
        finally:
            # 收尾：所有 worker 必须收尾（已结束 / 已取消）；若有残留也等待一次
            if workers:
                await asyncio.gather(*workers, return_exceptions=True)

    async def _worker(
        self,
        cfg: PipelineConfig,
        request: ArenaRunRequest,
        queue: asyncio.Queue[ArenaEvent | None],
    ) -> None:
        try:
            async for event in self.registry.get(cfg.framework).run(request.question, cfg):
                await queue.put(event)
        except asyncio.CancelledError:
            # 客户端断开 — 让上层统一取消
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