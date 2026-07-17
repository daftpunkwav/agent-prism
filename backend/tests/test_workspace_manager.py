"""WorkspaceManager TTL / LRU 回收测试。"""

import time

from app.arena.workspace import WorkspaceManager


def test_create_and_get():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=60)
    ws = mgr.create("a")
    ws.write_file("x.txt", "hi")
    got = mgr.get("a")
    assert got is not None
    assert got.read_file("x.txt") == "hi"
    assert mgr.count() == 1


def test_ttl_expires_workspace():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=0.15)
    mgr.create("old")
    time.sleep(0.2)
    assert mgr.get("old") is None
    assert mgr.count() == 0


def test_get_refreshes_ttl():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=0.25)
    mgr.create("keep")
    time.sleep(0.12)
    assert mgr.get("keep") is not None  # 刷新访问时间
    time.sleep(0.12)
    # 若未刷新，此处应已过期；刷新后仍存活
    assert mgr.get("keep") is not None


def test_lru_evicts_oldest_when_full():
    mgr = WorkspaceManager(max_workspaces=2, ttl_seconds=3600)
    mgr.create("w1")
    time.sleep(0.02)
    mgr.create("w2")
    time.sleep(0.02)
    # 访问 w1，使 w2 成为最久未访问
    assert mgr.get("w1") is not None
    time.sleep(0.02)
    mgr.create("w3")  # 应淘汰 w2
    assert mgr.get("w1") is not None
    assert mgr.get("w2") is None
    assert mgr.get("w3") is not None
    assert mgr.count() == 2


def test_cleanup_clears_all():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=60)
    mgr.create("a")
    mgr.create("b")
    mgr.cleanup()
    assert mgr.count() == 0
    assert mgr.get("a") is None


def test_cleanup_expired_returns_count():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=0.1)
    mgr.create("x")
    mgr.create("y")
    time.sleep(0.15)
    n = mgr.cleanup_expired()
    assert n == 2
    assert mgr.count() == 0


def test_remove_explicit():
    mgr = WorkspaceManager(max_workspaces=8, ttl_seconds=60)
    mgr.create("z")
    mgr.remove("z")
    assert mgr.get("z") is None
