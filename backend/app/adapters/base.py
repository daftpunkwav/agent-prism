"""框架适配器接口与注册表。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from app.models import ArenaEvent, PipelineConfig


class FrameworkAdapter(Protocol):
    framework_id: str
    display_name: str

    async def run(
        self, question: str, config: PipelineConfig
    ) -> AsyncIterator[ArenaEvent]:
        ...


class FrameworkAdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, FrameworkAdapter] = {}
        self._reserved: dict[str, str] = {
            "autogen": "AutoGen — Adapter 接入中",
            "crewai": "CrewAI — Adapter 接入中",
        }

    def register(self, adapter: FrameworkAdapter) -> None:
        self._adapters[adapter.framework_id] = adapter

    def get(self, framework_id: str) -> FrameworkAdapter:
        if framework_id in self._reserved and framework_id not in self._adapters:
            raise NotImplementedError(self._reserved[framework_id])
        adapter = self._adapters.get(framework_id)
        if not adapter:
            raise KeyError(f"未注册的框架: {framework_id}")
        return adapter

    def list_available(self) -> list[dict[str, str]]:
        return [
            {"id": a.framework_id, "name": a.display_name, "status": "available"}
            for a in self._adapters.values()
        ]

    def list_reserved(self) -> list[dict[str, str]]:
        return [
            {"id": fid, "name": label.split(" — ")[0], "status": "reserved"}
            for fid, label in self._reserved.items()
        ]
