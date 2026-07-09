"""Arena 实验台 API。"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from app.adapters.common import get_workspace_mgr
from app.arena.project import get_project_manager
from app.arena.runner import RunnerPool, build_registry
from app.models import ArenaRunRequest, ProjectCreate

router = APIRouter(prefix="/api/arena", tags=["arena"])

_pool = RunnerPool(build_registry())
_ws_mgr = get_workspace_mgr()


@router.get("/meta")
async def arena_meta():
    # 复用 RunnerPool 中的 registry，避免每个请求都重建适配器实例。
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
                "mvp": True,
            },
            {
                "id": "context",
                "label": "上下文",
                "subtitle": "仅切换 Memory 策略，需使用多轮任务模板",
                "columns": 4,
                "mvp": True,
            },
            {
                "id": "harness",
                "label": "Harness",
                "subtitle": "仅切换验证 / 反思循环，其余配置保持一致",
                "columns": 4,
                "mvp": True,
            },
        ],
        "frameworks": _pool.registry.list_available() + _pool.registry.list_reserved(),
    }


@router.post("/run")
async def arena_run(request: ArenaRunRequest):
    async def event_generator():
        try:
            async for event in _pool.stream_parallel(request):
                yield {"event": "arena", "data": json.dumps(event.model_dump(), ensure_ascii=False)}
        except asyncio.CancelledError:
            # 客户端断开连接时静默退出
            pass

    return EventSourceResponse(event_generator())


# ===== 工作空间 API =====


@router.get("/workspace/{workspace_name}/files")
async def workspace_files(workspace_name: str):
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    files = ws.list_files()
    return {
        "workspace": workspace_name,
        "files": [{"path": f, "size": len(ws.files[f].content)} for f in files],
    }


@router.get("/workspace/{workspace_name}/file")
async def workspace_file(workspace_name: str, path: str = Query(...)):
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    content = ws.read_file(path)
    if content.startswith("错误:"):
        raise HTTPException(status_code=404, detail=content)
    return {"path": path, "content": content}


@router.put("/workspace/{workspace_name}/file")
async def workspace_save_file(workspace_name: str, body: dict):
    """保存/创建工作空间中的文件"""
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    path = body.get("path", "").strip()
    content = body.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="文件路径不能为空")
    if body.get("create_only"):
        result = ws.create_file(path, content)
    else:
        result = ws.write_file(path, content)
    if result.startswith("错误:"):
        raise HTTPException(status_code=400, detail=result)
    return {"path": path, "message": result}


@router.delete("/workspace/{workspace_name}/file")
async def workspace_delete_file(workspace_name: str, path: str = Query(...)):
    """删除工作空间中的文件"""
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    result = ws.delete_file(path)
    if result.startswith("错误:"):
        raise HTTPException(status_code=400, detail=result)
    return {"path": path, "message": result}


# ===== 项目管理 API =====


@router.get("/projects")
async def list_projects():
    mgr = get_project_manager()
    return {"projects": [p.model_dump() for p in mgr.list_projects()]}


@router.post("/projects")
async def create_project(body: ProjectCreate):
    mgr = get_project_manager()
    project = mgr.create_from_run(body)
    return {"project": project.model_dump()}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    mgr = get_project_manager()
    ok = mgr.delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"deleted": project_id}
