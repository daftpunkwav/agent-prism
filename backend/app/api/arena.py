"""Arena 实验台 API。"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.adapters.common import get_workspace_mgr
from app.arena.judging import judge_answers
from app.arena.project import get_project_manager
from app.arena.router import DEFAULT_BASE, list_baseline_fields, list_dimension_options
from app.arena.runner import RunnerPool, build_registry
from app.arena.templates import get_template, template_payloads
from app.arena.workspace import WorkspaceError
from app.models import ArenaRunRequest, ProjectCreate, WorkspaceFileUpsert

router = APIRouter(prefix="/api/arena", tags=["arena"])

_DIMENSION_META: list[dict] = [
    {
        "id": "framework",
        "label": "框架",
        "subtitle": "编排实现不同，Prompt / 推理 / 上下文 / Harness 保持一致（可用基线覆盖）",
    },
    {
        "id": "prompt",
        "label": "提示词",
        "subtitle": "仅切换 Prompt 模板，其余维由基线固定",
    },
    {
        "id": "reasoning",
        "label": "推理模式",
        "subtitle": "仅切换推理图节点，其余维由基线固定",
    },
    {
        "id": "context",
        "label": "上下文",
        "subtitle": "仅切换 Memory 策略；滑动/摘要/向量在 LLM 调用前真实裁剪",
    },
    {
        "id": "harness",
        "label": "Harness",
        "subtitle": "仅切换验证 / 反思循环，其余维由基线固定",
    },
]

_pool = RunnerPool(build_registry())
_ws_mgr = get_workspace_mgr()


@router.get("/meta")
async def arena_meta():
    dimensions = []
    for meta in _DIMENSION_META:
        options = list_dimension_options(meta["id"])
        dimensions.append(
            {
                **meta,
                "options": options,
                "min_select": 2,
                "max_select": len(options),
            }
        )
    return {
        "dimensions": dimensions,
        "frameworks": _pool.registry.list_available() + _pool.registry.list_reserved(),
        "baseline_defaults": dict(DEFAULT_BASE),
        "baseline_fields": list_baseline_fields(),
    }


@router.post("/run")
async def arena_run(request: ArenaRunRequest):
    async def event_generator():
        try:
            async for event in _pool.stream_parallel(request):
                yield {"event": "arena", "data": json.dumps(event.model_dump(), ensure_ascii=False)}
        except asyncio.CancelledError:
            # 客户端断开 — runner 内部已取消所有 worker task，无需额外清理
            raise

    return EventSourceResponse(event_generator())


# ===== 任务模板 API =====


class JudgeRequest(BaseModel):
    """判分请求：template_id + {label: 最终答案文本}。"""

    template_id: str = Field(min_length=1, max_length=100)
    answers: dict[str, str] = Field(default_factory=dict, max_length=16)


@router.get("/templates")
async def arena_templates():
    """返回任务模板列表（含判分规则，前端可展示判分方式）。"""
    return {"templates": template_payloads()}


@router.post("/judge")
async def arena_judge(body: JudgeRequest):
    """对给定答案按模板判分规则自动判分（L1 格式/约束验证，无 LLM）。"""
    template = get_template(body.template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"模板不存在: {body.template_id}")
    results = judge_answers(body.answers, template.judge)
    return {
        "template_id": template.id,
        "template_name": template.name,
        "judge_type": template.judge.type,
        "results": {label: r.model_dump() for label, r in results.items()},
    }


# ===== 工作空间 API =====

# 安全说明：当前为单用户本地部署模型，workspace 名含随机后缀不可预测。
# 多用户部署时必须在此处增加所有权/会话校验，防止越权读写。


@router.get("/workspace/{workspace_name}/files")
async def workspace_files(workspace_name: str):
    """列出工作空间全部文件（递归），路径为完整相对路径，便于前端 buildTree。"""
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    # 返回全部 path（含嵌套），跳过目录占位 .gitkeep 亦可保留以便树形展示
    files = sorted(ws.files.keys())
    return {
        "workspace": workspace_name,
        "files": [{"path": f, "size": len(ws.files[f].content)} for f in files],
    }


@router.get("/workspace/{workspace_name}/file")
async def workspace_file(workspace_name: str, path: str = Query(...)):
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    try:
        content = ws.read_file(path)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"path": path, "content": content}


@router.put("/workspace/{workspace_name}/file")
async def workspace_save_file(workspace_name: str, body: WorkspaceFileUpsert):
    """保存/创建工作空间中的文件"""
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    try:
        if body.create_only:
            result = ws.create_file(body.path, body.content)
        else:
            result = ws.write_file(body.path, body.content)
    except WorkspaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"path": body.path, "message": result}


@router.delete("/workspace/{workspace_name}/file")
async def workspace_delete_file(workspace_name: str, path: str = Query(...)):
    """删除工作空间中的文件"""
    ws = _ws_mgr.get(workspace_name)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作空间不存在")
    try:
        result = ws.delete_file(path)
    except WorkspaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"path": path, "message": result}


# ===== 项目管理 API =====


@router.get("/projects")
async def list_projects():
    mgr = get_project_manager()
    return {"projects": [p.model_dump() for p in mgr.list_projects()]}


@router.post("/projects")
async def create_project(body: ProjectCreate):
    mgr = get_project_manager()
    try:
        project = mgr.create_from_run(body)
    except OSError:
        raise HTTPException(status_code=500, detail="项目保存失败") from None
    return {"project": project.model_dump()}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    mgr = get_project_manager()
    try:
        ok = mgr.delete_project(project_id)
    except OSError:
        raise HTTPException(status_code=500, detail="项目删除失败") from None
    if not ok:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"deleted": project_id}
