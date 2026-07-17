"""项目管理：从工作空间创建项目。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.adapters.common import get_workspace_mgr
from app.main import app

client = TestClient(app)


def test_create_project_from_workspaces():
    mgr = get_workspace_mgr()
    w1, w2 = "proj_ws_a", "proj_ws_b"
    mgr.create(w1).write_file("a.txt", "A")
    mgr.create(w2).write_file("b.txt", "B")
    try:
        res = client.post(
            "/api/arena/projects",
            json={
                "name": "测试项目",
                "question": "现在几点？",
                "dimension": "framework",
                "pipeline_labels": ["LangChain", "LangGraph"],
                "workspace_names": [w1, w2],
            },
        )
        assert res.status_code == 200, res.text
        project = res.json()["project"]
        assert project["name"] == "测试项目"
        assert w1 in project["workspace_files"] or len(project["results"]) >= 1
        # 清理
        client.delete(f"/api/arena/projects/{project['id']}")
    finally:
        mgr.remove(w1)
        mgr.remove(w2)


def test_list_projects_ok():
    res = client.get("/api/arena/projects")
    assert res.status_code == 200
    assert "projects" in res.json()
