"""项目管理 — 从 Arena 运行结果创建项目。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.adapters.common import get_workspace_mgr
from app.models import Project, ProjectCreate

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"


class ProjectManager:
    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._load()

    def _load(self) -> None:
        if PROJECTS_FILE.exists():
            try:
                data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
                for p in data:
                    self._projects[p["id"]] = Project(**p)
            except Exception:
                pass

    def _save(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        projects = [p.model_dump() for p in self._projects.values()]
        PROJECTS_FILE.write_text(
            json.dumps(projects, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

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
        for label in create.pipeline_labels:
            ws = ws_mgr.get(f"{label}_")
            if ws:
                file_count = len(ws.files)
                results.append({
                    "label": label,
                    "workspace": f"{label}_",
                    "file_count": file_count,
                    "files": list(ws.files.keys()),
                })

        project = Project(
            id=f"proj_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
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
