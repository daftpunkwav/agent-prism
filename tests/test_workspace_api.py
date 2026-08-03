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


# ===== workspace 文件读写端点 =====


def test_workspace_save_and_read_file():
    mgr = get_workspace_mgr()
    name = "api_ws_rw"
    mgr.create(name)
    try:
        res = client.put(
            f"/api/arena/workspace/{name}/file",
            json={"path": "a.py", "content": "print(1)"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["message"].startswith("已写入")

        res = client.get(f"/api/arena/workspace/{name}/file", params={"path": "a.py"})
        assert res.status_code == 200
        assert res.json()["content"] == "print(1)"
    finally:
        mgr.remove(name)


def test_workspace_delete_file():
    mgr = get_workspace_mgr()
    name = "api_ws_del"
    ws = mgr.create(name)
    ws.write_file("b.txt", "x")
    try:
        res = client.delete(f"/api/arena/workspace/{name}/file", params={"path": "b.txt"})
        assert res.status_code == 200
        assert "已删除" in res.json()["message"]
        assert "b.txt" not in ws.files
    finally:
        mgr.remove(name)


def test_workspace_file_not_found_404():
    mgr = get_workspace_mgr()
    name = "api_ws_missing"
    mgr.create(name)
    try:
        res = client.get(f"/api/arena/workspace/{name}/file", params={"path": "nope.txt"})
        assert res.status_code == 404
    finally:
        mgr.remove(name)


def test_workspace_invalid_path_400():
    mgr = get_workspace_mgr()
    name = "api_ws_badpath"
    mgr.create(name)
    try:
        # 向上遍历路径应返回 400（不是成功保存）
        res = client.put(
            f"/api/arena/workspace/{name}/file",
            json={"path": "../evil.txt", "content": "x"},
        )
        assert res.status_code == 400
    finally:
        mgr.remove(name)


def test_workspace_create_only_prevents_overwrite():
    mgr = get_workspace_mgr()
    name = "api_ws_createonly"
    ws = mgr.create(name)
    ws.write_file("keep.txt", "v1")
    try:
        # create_only 且文件已存在 → 400
        res = client.put(
            f"/api/arena/workspace/{name}/file",
            json={"path": "keep.txt", "content": "v2", "create_only": True},
        )
        assert res.status_code == 400
        assert ws.read_file("keep.txt") == "v1"
        # 非 create_only 可覆盖
        res = client.put(
            f"/api/arena/workspace/{name}/file",
            json={"path": "keep.txt", "content": "v3"},
        )
        assert res.status_code == 200
        assert ws.read_file("keep.txt") == "v3"
    finally:
        mgr.remove(name)


def test_workspace_write_404_for_unknown_workspace():
    res = client.put(
        "/api/arena/workspace/does_not_exist_xyz/file",
        json={"path": "a.py", "content": "x"},
    )
    assert res.status_code == 404
