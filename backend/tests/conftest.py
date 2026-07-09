"""全局 pytest fixtures。

设计目标：
1. 每次测试自动失效 router 层的 lru_cache（避免跨测试 provider 串味）
2. 将 ProjectManager 重定向到 ``tmp_path``（隔离开发者的真实 ``data/``）
3. 重置 ProjectManager 单例与各 provider 配置缓存
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app import config as app_config
from app.arena import project as project_module
from app.arena.router import invalidate_provider_cache


@pytest.fixture(autouse=True)
def _reset_provider_cache() -> None:
    """每个测试前后失效 lru_cache，确保 provider 配置变更立即生效。"""
    invalidate_provider_cache()
    yield
    invalidate_provider_cache()


@pytest.fixture
def isolated_projects_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """把 ``ProjectManager.PROJECTS_FILE`` 指向 ``tmp_path/projects.json``。"""
    target = tmp_path / "projects.json"
    monkeypatch.setattr(project_module, "PROJECTS_FILE", target)
    project_module.reset_project_manager_for_tests()
    yield target
    project_module.reset_project_manager_for_tests()


@pytest.fixture
def isolated_provider_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """把 ``config.PROVIDER_CONFIG_PATH`` 指向 ``tmp_path/provider_config.json``。"""
    target = tmp_path / "provider_config.json"
    monkeypatch.setattr(app_config, "PROVIDER_CONFIG_PATH", target)
    invalidate_provider_cache()
    yield target
    invalidate_provider_cache()