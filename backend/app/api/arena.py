"""Arena 实验台 API。"""

from __future__ import annotations

import json

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from app.adapters.base import FrameworkAdapterRegistry
from app.arena.runner import RunnerPool, build_registry
from app.arena.router import DimensionRouter
from app.models import ArenaRunRequest

router = APIRouter(prefix="/api/arena", tags=["arena"])

_pool = RunnerPool(build_registry())
_router = DimensionRouter()


@router.get("/meta")
async def arena_meta():
    registry: FrameworkAdapterRegistry = build_registry()
    return {
        "dimensions": [
            {
                "id": "framework",
                "label": "框架",
                "subtitle": "编排实现不同，Prompt / 推理 / 上下文 / Harness 保持一致",
                "columns": 2,
                "mvp": True,
            },
            {
                "id": "prompt",
                "label": "提示词",
                "subtitle": "仅切换 Prompt 模板，LangGraph + ReAct 编排不变",
                "columns": 4,
                "mvp": True,
            },
            {
                "id": "reasoning",
                "label": "推理模式",
                "subtitle": "仅切换推理图节点，Prompt 基线保持一致",
                "columns": 4,
                "mvp": False,
            },
            {
                "id": "context",
                "label": "上下文",
                "subtitle": "仅切换 Memory 策略，需使用多轮任务模板",
                "columns": 4,
                "mvp": False,
            },
            {
                "id": "harness",
                "label": "Harness",
                "subtitle": "仅切换验证 / 反思循环，其余配置保持一致",
                "columns": 4,
                "mvp": False,
            },
        ],
        "frameworks": registry.list_available() + registry.list_reserved(),
    }


@router.post("/run")
async def arena_run(request: ArenaRunRequest):
    async def event_generator():
        async for event in _pool.stream_parallel(request):
            yield {"event": "arena", "data": json.dumps(event.model_dump(), ensure_ascii=False)}

    return EventSourceResponse(event_generator())
