"""框架适配器接口与注册表。

新增适配器只需：
1. 继承 Protocol 实现 run() 方法
2. 调用 register() 注册
3. 在 reserved 中移除对应框架

示例：
    class AutoGenAdapter:
        framework_id = "autogen"
        display_name = "AutoGen"
        async def run(self, question, config):
            ...

    registry = FrameworkAdapterRegistry()
    registry.register(AutoGenAdapter())
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from app.models import ArenaEvent, PipelineConfig


@runtime_checkable
class FrameworkAdapter(Protocol):
    """框架适配器接口。"""

    framework_id: str
    display_name: str

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        """流式运行并产出 ArenaEvent。"""
        ...


class AdapterNotFoundError(KeyError):
    """适配器未找到。"""

    def __init__(self, framework_id: str) -> None:
        super().__init__(f"未注册的框架: {framework_id}")
        self.framework_id = framework_id


class AdapterReservedError(NotImplementedError):
    """适配器预留未实现。"""

    def __init__(self, framework_id: str, reason: str) -> None:
        super().__init__(f"{framework_id}: {reason}")
        self.framework_id = framework_id
        self.reason = reason


class FrameworkAdapterRegistry:
    """框架适配器注册表。支持热插拔。"""

    def __init__(self) -> None:
        self._adapters: dict[str, FrameworkAdapter] = {}
        self._reserved: dict[str, str] = {
            "autogen": "AutoGen — Adapter 接入中",
            "crewai": "CrewAI — Adapter 接入中",
        }
        self._listeners: list = []

    def register(self, adapter: FrameworkAdapter) -> None:
        """注册一个适配器实例。"""
        if not isinstance(adapter, FrameworkAdapter):
            raise TypeError(f"适配器必须实现 FrameworkAdapter 协议: {type(adapter)}")
        self._adapters[adapter.framework_id] = adapter
        # 注册即激活：从 reserved 移除
        self._reserved.pop(adapter.framework_id, None)
        self._notify_change(adapter.framework_id, "registered")

    def unregister(self, framework_id: str) -> None:
        """注销适配器（回到 reserved 状态）。"""
        self._adapters.pop(framework_id, None)
        self._notify_change(framework_id, "unregistered")

    def get(self, framework_id: str) -> FrameworkAdapter:
        if framework_id in self._reserved and framework_id not in self._adapters:
            raise AdapterReservedError(framework_id, self._reserved[framework_id])
        adapter = self._adapters.get(framework_id)
        if not adapter:
            raise AdapterNotFoundError(framework_id)
        return adapter

    def try_get(self, framework_id: str) -> FrameworkAdapter | None:
        """安全获取，找不到返回 None。"""
        try:
            return self.get(framework_id)
        except (AdapterNotFoundError, AdapterReservedError):
            return None

    def list_available(self) -> list[dict[str, str]]:
        return [{"id": a.framework_id, "name": a.display_name, "status": "available"} for a in self._adapters.values()]

    def list_reserved(self) -> list[dict[str, str]]:
        return [{"id": fid, "name": label.split(" — ")[0], "status": "reserved"} for fid, label in self._reserved.items()]

    def add_change_listener(self, listener) -> None:
        """注册变更监听器。"""
        self._listeners.append(listener)

    def _notify_change(self, framework_id: str, action: str) -> None:
        for listener in self._listeners:
            try:
                listener(framework_id, action)
            except Exception:
                # 监听器异常不影响主流程
                pass
