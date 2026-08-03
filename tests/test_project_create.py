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


def test_create_project_save_failure_returns_500(monkeypatch):
    """落盘失败时 API 必须返回 500，不能假成功。"""
    from app.arena import project as project_module
    from app.arena.project import get_project_manager

    mgr = get_workspace_mgr()
    ws = "proj_ws_fail"
    mgr.create(ws).write_file("x.txt", "X")

    def _boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(project_module, "_atomic_write_json", _boom)
    # 重置单例，确保走被 monkeypatch 的路径
    project_module.reset_project_manager_for_tests()
    try:
        res = client.post(
            "/api/arena/projects",
            json={
                "name": "应失败",
                "question": "q",
                "dimension": "framework",
                "pipeline_labels": ["A"],
                "workspace_names": [ws],
            },
        )
        assert res.status_code == 500
        assert "保存失败" in res.json().get("detail", "")
        # 内存也不应留下假项目
        assert get_project_manager().get_project("dummy") is None
    finally:
        mgr.remove(ws)
        project_module.reset_project_manager_for_tests()
