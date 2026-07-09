"""项目管理 — 从 Arena 运行结果创建项目。

并发安全要点：
- 单实例 ``ProjectManager`` 通过 ``threading.Lock`` 序列化所有读写
- 项目 ID = 时间戳 + UUID4 后缀（避免同毫秒并发冲突）
- 持久化通过 :mod:`app.storage` 原子写，旧版本备份到 ``projects.json.bak``
- IO 错误向上抛 HTTPException（不再静默吞日志）
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from app.adapters.common import get_workspace_mgr
from app.models import Project, ProjectCreate
from app.storage import _atomic_write_json

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"


def _generate_project_id() -> str:
    """生成唯一项目 ID：时间戳 + 4 字节 UUID 后缀，避免任何并发碰撞。"""
    now = datetime.now(timezone.utc)
    return f"proj_{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


class ProjectManager:
    """线程安全的项目管理器。"""

    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._lock = threading.Lock()
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
        """原子写入 projects.json。失败时记录日志并重新抛出。"""
        try:
            payload = [p.model_dump() for p in self._projects.values()]
            _atomic_write_json(PROJECTS_FILE, payload)
        except OSError as exc:
            logger.error("保存 %s 失败: %s", PROJECTS_FILE, exc)
            raise

    def list_projects(self) -> list[Project]:
        with self._lock:
            return sorted(self._projects.values(), key=lambda p: p.created_at, reverse=True)

    def get_project(self, project_id: str) -> Project | None:
        with self._lock:
            return self._projects.get(project_id)

    def create_from_run(
        self,
        create: ProjectCreate,
        workspace_files: dict[str, dict[str, str]] | None = None,
        metrics: dict[str, dict] | None = None,
    ) -> Project:
        """从 Arena 运行结果创建项目记录。

        参数:
            create: 前端提交的 ProjectCreate（含 workspace_names）
            workspace_files: 可选预聚合的 {ws_name: {path: content}}
            metrics: 可选 metrics 摘要 {ws_name: metrics dict}
        """
        ws_mgr = get_workspace_mgr()
        ws_data: dict[str, dict[str, str]] = {}
        results: list[dict] = []

        with self._lock:
            for ws_name in create.workspace_names:
                ws = ws_mgr.get(ws_name)
                if ws is None:
                    continue
                ws_data[ws_name] = {path: f.content for path, f in ws.files.items()}
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
                workspace_files=workspace_files or ws_data,
                metrics_summary=metrics or {},
            )
            self._projects[project.id] = project
            self._save()
            return project

    def delete_project(self, project_id: str) -> bool:
        with self._lock:
            if project_id not in self._projects:
                return False
            del self._projects[project_id]
            self._save()
            return True


_project_mgr: ProjectManager | None = None
_project_mgr_lock = threading.Lock()


def get_project_manager() -> ProjectManager:
    """线程安全的全局 ProjectManager 单例。"""
    global _project_mgr
    if _project_mgr is None:
        with _project_mgr_lock:
            if _project_mgr is None:
                _project_mgr = ProjectManager()
    return _project_mgr


def reset_project_manager_for_tests() -> None:
    """供测试重置单例 — 不应在生产代码中调用。"""
    global _project_mgr
    with _project_mgr_lock:
        _project_mgr = None