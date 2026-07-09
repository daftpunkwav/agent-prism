"""ProjectManager 单元测试 — 线程安全、原子写、并发创建不冲突。"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.arena.project import (
    ProjectManager,
    _generate_project_id,
    get_project_manager,
    reset_project_manager_for_tests,
)
from app.models import ProjectCreate


def _make_create(name: str, workspace_names: list[str] | None = None) -> ProjectCreate:
    return ProjectCreate(
        name=name,
        question="测试问题",
        dimension="framework",
        pipeline_labels=["default"],
        workspace_names=workspace_names or ["default"],
    )


def test_unique_ids_under_burst():
    """同毫秒内多次调用仍产生唯一 ID。"""
    ids = {_generate_project_id() for _ in range(50)}
    assert len(ids) == 50


def test_create_and_list(isolated_projects_file):
    mgr = ProjectManager()
    project = mgr.create_from_run(_make_create("实验 A"))
    assert project.id.startswith("proj_")

    listed = mgr.list_projects()
    assert len(listed) == 1
    assert listed[0].name == "实验 A"


def test_delete(isolated_projects_file):
    mgr = ProjectManager()
    project = mgr.create_from_run(_make_create("实验 B"))
    assert mgr.delete_project(project.id) is True
    assert mgr.get_project(project.id) is None
    # 二次删除返回 False
    assert mgr.delete_project(project.id) is False


def test_atomic_write_creates_backup(isolated_projects_file, tmp_path):
    """第二次写入应同时生成 .bak 文件。"""
    mgr = ProjectManager()
    mgr.create_from_run(_make_create("v1"))
    mgr.create_from_run(_make_create("v2"))

    bak = tmp_path / "projects.json.bak"
    assert bak.exists()
    # 备份的内容是 v1 时的快照
    import json

    snap = json.loads(bak.read_text(encoding="utf-8"))
    assert any(p["name"] == "v1" for p in snap)


def test_concurrent_create_no_overwrite(isolated_projects_file):
    """N 个线程并发创建项目 — 全部应保留，无相互覆盖。"""
    mgr = ProjectManager()
    n = 20

    def worker(i: int) -> None:
        mgr.create_from_run(_make_create(f"实验-{i}"))

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(worker, range(n)))

    listed = mgr.list_projects()
    assert len(listed) == n
    names = {p.name for p in listed}
    assert len(names) == n


def test_concurrent_create_preserves_all_on_disk(isolated_projects_file):
    """并发创建后，从磁盘 reload 仍能看到全部项目。"""
    mgr = ProjectManager()
    n = 15

    def worker(i: int) -> None:
        mgr.create_from_run(_make_create(f"disk-{i}"))

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(worker, range(n)))

    # 重新构造一个 manager 触发 _load，验证落盘完整性
    reset_project_manager_for_tests()
    mgr2 = ProjectManager()
    listed = mgr2.list_projects()
    assert len(listed) == n
    assert {p.name for p in listed} == {f"disk-{i}" for i in range(n)}


def test_save_io_error_bubbles(isolated_projects_file, monkeypatch):
    """磁盘写入失败应向上抛，不再静默吞日志。"""
    from app.arena import project as project_module

    mgr = ProjectManager()
    mgr.create_from_run(_make_create("before"))

    def _boom(_path, _payload, **_kw):
        raise OSError("disk full")

    monkeypatch.setattr(project_module, "_atomic_write_json", _boom)

    with pytest.raises(OSError, match="disk full"):
        mgr.create_from_run(_make_create("after"))


def test_singleton_double_init_locked(monkeypatch):
    """get_project_manager 双检查锁 — 即使并发也只构造一次。"""
    reset_project_manager_for_tests()
    # 记录真实构造次数
    real_init = ProjectManager.__init__
    counter = {"n": 0}

    def counting_init(self):
        counter["n"] += 1
        real_init(self)

    monkeypatch.setattr(ProjectManager, "__init__", counting_init)

    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()
        return get_project_manager()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: worker(), range(8)))

    assert counter["n"] == 1
    # 所有线程拿到的是同一个实例
    assert all(r is results[0] for r in results)


def test_create_with_workspace_files(isolated_projects_file):
    """显式传入 workspace_files 时不再尝试从 ws_mgr 拉取。"""
    mgr = ProjectManager()
    project = mgr.create_from_run(
        _make_create("preset", workspace_names=["不存在"]),
        workspace_files={"不存在": {"main.py": "print(1)"}},
        metrics={"不存在": {"duration_ms": 100}},
    )
    assert project.workspace_files == {"不存在": {"main.py": "print(1)"}}
    assert project.metrics_summary == {"不存在": {"duration_ms": 100}}