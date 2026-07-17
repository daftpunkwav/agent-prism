"""根目录 tests 的共享 fixture。

确保 `backend` 在 sys.path 上，以便 `import app.*`。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def anyio_backend():
    """anyio 插件默认后端（若启用）。"""
    return "asyncio"
