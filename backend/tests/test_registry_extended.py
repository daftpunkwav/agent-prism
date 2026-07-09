"""FrameworkAdapterRegistry 增强功能的单元测试。"""

import pytest

from app.adapters.base import (
    AdapterNotFoundError,
    AdapterReservedError,
    FrameworkAdapterRegistry,
)


def test_try_get_returns_none_for_missing():
    """try_get 在找不到时返回 None 而非抛出"""
    reg = FrameworkAdapterRegistry()
    assert reg.try_get("nonexistent") is None


def test_try_get_returns_none_for_reserved():
    """try_get 对 reserved 框架也返回 None"""
    reg = FrameworkAdapterRegistry()
    assert reg.try_get("autogen") is None


def test_unregister_removes_adapter():
    """unregister 移除适配器"""
    reg = FrameworkAdapterRegistry()

    class FakeAdapter:
        framework_id = "fake"
        display_name = "Fake"

        async def run(self, question, config):
            if False:
                yield None

    reg.register(FakeAdapter())
    assert reg.try_get("fake") is not None
    reg.unregister("fake")
    assert reg.try_get("fake") is None


def test_register_invalid_type_raises():
    """register 非协议对象应抛出 TypeError"""
    reg = FrameworkAdapterRegistry()

    with pytest.raises(TypeError):
        reg.register("not_an_adapter")


def test_register_promotes_from_reserved():
    """注册时自动从 reserved 移除"""
    reg = FrameworkAdapterRegistry()
    assert reg.try_get("autogen") is None

    class AutoGenAdapter:
        framework_id = "autogen"
        display_name = "AutoGen"

        async def run(self, question, config):
            if False:
                yield None

    reg.register(AutoGenAdapter())
    assert reg.try_get("autogen") is not None
    # reserved 列表应不再包含 autogen
    assert all(r["id"] != "autogen" for r in reg.list_reserved())


def test_change_listener_called():
    """注册监听器在变更时被调用"""
    reg = FrameworkAdapterRegistry()
    calls = []
    reg.add_change_listener(lambda fid, action: calls.append((fid, action)))

    class Adapter:
        framework_id = "listener_test"
        display_name = "Test"

        async def run(self, question, config):
            if False:
                yield None

    reg.register(Adapter())
    reg.unregister("listener_test")

    assert ("listener_test", "registered") in calls
    assert ("listener_test", "unregistered") in calls


def test_change_listener_exception_does_not_propagate():
    """监听器异常不影响主流程"""
    reg = FrameworkAdapterRegistry()

    def bad_listener(fid, action):
        raise RuntimeError("listener error")

    reg.add_change_listener(bad_listener)

    class Adapter:
        framework_id = "test"
        display_name = "Test"

        async def run(self, question, config):
            if False:
                yield None

    # 应不抛出
    reg.register(Adapter())


def test_adapter_not_found_error_has_framework_id():
    err = AdapterNotFoundError("foo")
    assert err.framework_id == "foo"
    assert "foo" in str(err)


def test_adapter_reserved_error_has_details():
    err = AdapterReservedError("autogen", "reserved for future")
    assert err.framework_id == "autogen"
    assert err.reason == "reserved for future"
    assert "autogen" in str(err)


def test_list_available_excludes_reserved():
    reg = FrameworkAdapterRegistry()
    # 默认 autogen/crewai 是 reserved
    available = reg.list_available()
    reserved = reg.list_reserved()
    assert all(a["id"] not in ("autogen", "crewai") for a in available)
    assert len(reserved) == 2
