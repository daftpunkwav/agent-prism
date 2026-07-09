"""项目管理 — 从 Arena 运行结果创建项目。"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from app.adapters.common import get_workspace_mgr
from app.models import Project, ProjectCreate

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"


def _generate_project_id() -> str:
    """生成唯一项目 ID；同毫秒创建多个项目时追加微秒避免冲突。"""
    now = datetime.now(timezone.utc)
    return f"proj_{now.strftime('%Y%m%d_%H%M%S')}_{now.microsecond:06d}"


class ProjectManager:
    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._load()

    def _load(self) -> None:
        if not PROJECTS_FILE.exists():
            return
        try:
            data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            logger.warning("解析 %s 失败: %s", PROJECTS_FILE, exc)
            return
        for p in data:
            try:
                self._projects[p["id"]] = Project(**p)
            except (ValidationError, KeyError, TypeError) as exc:
                logger.warning("跳过无效项目记录 %s: %s", p.get("id"), exc)

    def _save(self) -> None:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            projects = [p.model_dump() for p in self._projects.values()]
            PROJECTS_FILE.write_text(
                json.dumps(projects, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            # 写失败不应让上层 API 500，但需记录以便排障
            logger.error("保存 %s 失败: %s", PROJECTS_FILE, exc)

    def list_projects(self) -> list[Project]:
        return sorted(self._projects.values(), key=lambda p: p.created_at, reverse=True)

    def get_project(self, project_id: str) -> Project | None:
        return self._projects.get(project_id)

    def create_from_run(
        self,
        create: ProjectCreate,
        workspace_files: dict[str, str] | None = None,
        metrics: dict[str, dict] | None = None,
    ) -> Project:
        ws_mgr = get_workspace_mgr()
        ws_data: dict[str, str] = {}
        for ws_name in create.workspace_names:
            ws = ws_mgr.get(ws_name)
            if ws:
                ws_data[ws_name] = {path: f.content for path, f in ws.files.items()}

        all_files = workspace_files or ws_data
        results = []
        for ws_name in create.workspace_names:
            # workspace_names 是 adapter 生成的完整名称（含毫秒时间戳），
            # 直接精确匹配，避免前缀模糊查找导致同 label 多次跑时互相覆盖。
            ws = ws_mgr.get(ws_name)
            if ws:
                results.append(
                    {
                        "label": ws_name,
                        "workspace": ws_name,
                        "file_count": len(ws.files),
                        "files": list(ws.files.keys()),
                    }
                )

        project = Project(
            id=_generate_project_id(),
            name=create.name,
            question=create.question,
            dimension=create.dimension,
            created_at=datetime.now(timezone.utc).isoformat(),
            results=results,
            workspace_files=all_files or {},
            metrics_summary=metrics or {},
        )
        self._projects[project.id] = project
        self._save()
        return project

    def delete_project(self, project_id: str) -> bool:
        if project_id in self._projects:
            del self._projects[project_id]
            self._save()
            return True
        return False


_project_mgr: ProjectManager | None = None


def get_project_manager() -> ProjectManager:
    global _project_mgr
    if _project_mgr is None:
        _project_mgr = ProjectManager()
    return _project_mgr
