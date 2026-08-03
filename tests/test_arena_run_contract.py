"""Arena /run SSE 契约：假 Adapter 端到端事件序列。"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import FrameworkAdapterRegistry
from app.arena.router import reset_dimension_options, sync_framework_options_from_registry
from app.arena.runner import RunnerPool, build_registry
from app.main import app
from app.models import ArenaEvent, PipelineConfig, PipelineMetrics


class _FakeAdapter:
    framework_id = "fake_a"
    display_name = "FakeA"

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        yield ArenaEvent(type="thought", pipeline=label, content="hello")
        yield ArenaEvent(
            type="complete",
            pipeline=label,
            workspace="ws-fake",
            metrics=PipelineMetrics(success=True, duration_ms=1),
        )


class _FakeAdapterB(_FakeAdapter):
    framework_id = "fake_b"
    display_name = "FakeB"


@pytest.fixture()
def client_with_fake_pool(monkeypatch: pytest.MonkeyPatch):
    registry = FrameworkAdapterRegistry()
    registry.register(_FakeAdapter())
    registry.register(_FakeAdapterB())
    pool = RunnerPool(registry)

    import app.api.arena as arena_api

    monkeypatch.setattr(arena_api, "_pool", pool)
    client = TestClient(app)
    yield client
    # 恢复全局维度选项，避免污染其它测试
    reset_dimension_options()
    sync_framework_options_from_registry(build_registry())


def test_arena_meta_lists_fake_frameworks(client_with_fake_pool: TestClient):
    res = client_with_fake_pool.get("/api/arena/meta")
    assert res.status_code == 200
    data = res.json()
    fw_ids = {f["id"] for f in data["frameworks"] if f["status"] == "available"}
    assert "fake_a" in fw_ids and "fake_b" in fw_ids
    framework_dim = next(d for d in data["dimensions"] if d["id"] == "framework")
    values = {o["value"] for o in framework_dim["options"]}
    assert values == {"fake_a", "fake_b"}


def test_arena_run_sse_emits_thought_and_complete(client_with_fake_pool: TestClient):
    with client_with_fake_pool.stream(
        "POST",
        "/api/arena/run",
        json={
            "question": "ping",
            "dimension": "framework",
            "selections": ["fake_a", "fake_b"],
        },
    ) as res:
        assert res.status_code == 200
        body = "".join(res.iter_text())

    payloads = []
    for line in body.splitlines():
        if line.startswith("data:"):
            payloads.append(json.loads(line[5:].strip()))

    types = {p.get("type") for p in payloads}
    assert "thought" in types
    assert "complete" in types
    pipelines = {p.get("pipeline") for p in payloads}
    assert "FakeA" in pipelines and "FakeB" in pipelines


def test_arena_templates_and_judge(client_with_fake_pool: TestClient):
    res = client_with_fake_pool.get("/api/arena/templates")
    assert res.status_code == 200
    templates = res.json()["templates"]
    assert any(t.get("category") == "quick" for t in templates)
    scored = next(t for t in templates if t["id"] == "arithmetic_mix")
    judge = client_with_fake_pool.post(
        "/api/arena/judge",
        json={"template_id": scored["id"], "answers": {"A": "384"}},
    )
    assert judge.status_code == 200
    assert judge.json()["results"]["A"]["passed"] is True
