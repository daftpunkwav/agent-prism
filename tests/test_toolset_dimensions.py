"""工具集过滤与维度路由扩展测试。"""

from __future__ import annotations

import pytest

from app.arena.router import DimensionRouter, reset_dimension_options, sync_framework_options_from_registry, sync_model_options_from_provider
from app.arena.runner import build_registry
from app.arena.tools import (
    ARENA_TOOLS,
    clear_active_toolset,
    get_active_tools,
    select_tools,
    set_active_toolset,
)
from app.config import ProviderConfig


@pytest.fixture(autouse=True)
def _restore_options():
    reset_dimension_options()
    sync_framework_options_from_registry(build_registry())
    sync_model_options_from_provider(
        ProviderConfig(model="test-model-a", models=["test-model-b"])
    )
    clear_active_toolset()
    yield
    reset_dimension_options()
    sync_framework_options_from_registry(build_registry())
    sync_model_options_from_provider(
        ProviderConfig(model="test-model-a", models=["test-model-b"])
    )
    clear_active_toolset()


def test_select_tools_full_equals_arena_tools():
    names = {t.name for t in select_tools("full")}
    assert names == {t.name for t in ARENA_TOOLS}


def test_select_tools_calc_time_is_subset():
    tools = select_tools("calc_time")
    assert {t.name for t in tools} == {"calculate", "get_current_time"}


def test_select_tools_code_file_excludes_summarize():
    names = {t.name for t in select_tools("code_file")}
    assert "run_code" in names
    assert "write_file" in names
    assert "summarize_text" not in names
    assert "get_current_time" not in names


def test_active_toolset_contextvar():
    set_active_toolset("workspace_read")
    assert {t.name for t in get_active_tools()} == {
        "read_file",
        "list_files",
        "file_tree",
        "summarize_text",
        "get_current_time",
    }
    clear_active_toolset()
    assert len(get_active_tools()) == len(ARENA_TOOLS)


def test_new_dimensions_route_real_fields():
    r = DimensionRouter()
    temps = r.route("temperature", selections=["0", "0.7"])
    assert [c.temperature for c in temps] == [0.0, 0.7]

    steps = r.route("max_steps", selections=["5", "15"])
    assert [c.max_steps for c in steps] == [5, 15]

    tools = r.route("toolset", selections=["full", "calc_time"])
    assert [c.toolset for c in tools] == ["full", "calc_time"]

    all_models = r.route("model")
    assert len(all_models) >= 2
    assert len({c.model_id for c in all_models}) >= 2


def test_all_nine_dimensions_route():
    r = DimensionRouter()
    dims = (
        "framework",
        "prompt",
        "reasoning",
        "context",
        "harness",
        "temperature",
        "model",
        "max_steps",
        "toolset",
    )
    for dim in dims:
        configs = r.route(dim)  # type: ignore[arg-type]
        assert len(configs) >= 2, dim


def test_baseline_temperature_does_not_override_temp_dimension():
    r = DimensionRouter()
    configs = r.route(
        "temperature",
        selections=["0", "1"],
        baseline={"temperature": 0.7, "framework": "langgraph"},
    )
    assert [c.temperature for c in configs] == [0.0, 1.0]
    assert all(c.framework == "langgraph" for c in configs)


def test_runner_skips_global_temp_when_comparing_temperature():
    from app.arena.runner import RunnerPool
    from app.models import ArenaRunRequest

    pool = RunnerPool()
    req = ArenaRunRequest(
        question="测试",
        dimension="temperature",
        selections=["0", "0.7"],
        temperature=1.0,
    )
    configs = pool.configs_for(req)
    assert [c.temperature for c in configs] == [0.0, 0.7]
