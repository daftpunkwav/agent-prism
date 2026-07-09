"""框架适配器注册表的单元测试。"""

from collections.abc import AsyncIterator

import pytest

from app.adapters.base import FrameworkAdapterRegistry
from app.models import ArenaEvent, PipelineConfig


class _FakeAdapter:
    framework_id = "fake"
    display_name = "Fake"

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:  # pragma: no cover - 仅用于类型
        yield ArenaEvent(type="complete", pipeline="Fake")


def test_register_and_get():
    reg = FrameworkAdapterRegistry()
    adapter = _FakeAdapter()
    reg.register(adapter)
    assert reg.get("fake") is adapter


def test_reserved_framework_raises_not_implemented():
    reg = FrameworkAdapterRegistry()
    with pytest.raises(NotImplementedError):
        reg.get("autogen")


def test_unknown_framework_raises_key_error():
    reg = FrameworkAdapterRegistry()
    with pytest.raises(KeyError):
        reg.get("unknown")


def test_list_available_and_reserved():
    reg = FrameworkAdapterRegistry()
    reg.register(_FakeAdapter())
    available = reg.list_available()
    assert available == [{"id": "fake", "name": "Fake", "status": "available"}]

    reserved_ids = {r["id"] for r in reg.list_reserved()}
    assert {"autogen", "crewai"} <= reserved_ids
