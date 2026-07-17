"""工作空间 HTTP API：递归文件列表。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.adapters.common import get_workspace_mgr
from app.main import app

client = TestClient(app)


def test_workspace_files_lists_nested_paths():
    mgr = get_workspace_mgr()
    name = "api_ws_nested"
    ws = mgr.create(name)
    ws.write_file("README.md", "root")
    ws.write_file("src/main.py", "print(1)")
    try:
        res = client.get(f"/api/arena/workspace/{name}/files")
        assert res.status_code == 200
        paths = {f["path"] for f in res.json()["files"]}
        assert "README.md" in paths
        assert "src/main.py" in paths
    finally:
        mgr.remove(name)


def test_workspace_not_found():
    res = client.get("/api/arena/workspace/does_not_exist_xyz/files")
    assert res.status_code == 404
