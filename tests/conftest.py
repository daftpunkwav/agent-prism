"""根目录 tests 的共享 fixture。

确保 `backend` 在 sys.path 上，以便 `import app.*`。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app import config as app_config
from app.arena import project as project_module
from app.arena.router import invalidate_provider_cache

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def anyio_backend():
    """anyio 插件默认后端（若启用）。"""
    return "asyncio"


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
