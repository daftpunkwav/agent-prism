"""Pydantic 模型边界校验测试 — 防止恶意/异常输入。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import (
    ArenaRunRequest,
    PipelineRunResult,
    ProjectCreate,
    ProviderConfigUpdate,
    WorkspaceFileUpsert,
)


def test_arena_request_temperature_bounded():
    """temperature ∈ [0, 2]"""
    ArenaRunRequest(question="x", temperature=1.5)
    with pytest.raises(ValidationError):
        ArenaRunRequest(question="x", temperature=3.0)
    with pytest.raises(ValidationError):
        ArenaRunRequest(question="x", temperature=-0.1)


def test_arena_request_selections_capped():
    """selections 最多 16 项 — 防止恶意大数组"""
    ArenaRunRequest(question="x", selections=["a"] * 16)
    with pytest.raises(ValidationError):
        ArenaRunRequest(question="x", selections=["a"] * 17)


def test_arena_request_question_max_length():
    """question 长度上限 4000"""
    ArenaRunRequest(question="x" * 4000)
    with pytest.raises(ValidationError):
        ArenaRunRequest(question="x" * 4001)


def test_provider_update_invalid_top_p():
    """top_p ∈ [0, 1]"""
    ProviderConfigUpdate(top_p=1.0)
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(top_p=1.5)


def test_provider_update_invalid_temperature():
    ProviderConfigUpdate(temperature=2.0)
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(temperature=2.5)


def test_provider_update_invalid_context_window():
    """context_window 至少 1024"""
    ProviderConfigUpdate(context_window=1024)
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(context_window=100)


def test_provider_update_api_key_max_length():
    """api_key 长度上限 4096，防止存储超大字符串"""
    ProviderConfigUpdate(api_key="x" * 4096)
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(api_key="x" * 4097)


def test_provider_update_base_url_max_length():
    ProviderConfigUpdate(base_url="https://" + "a" * 490)
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(base_url="https://" + "a" * 500)


def test_project_create_requires_pipeline_labels():
    """pipeline_labels 必须 ≥ 1 — 避免空项目"""
    ProjectCreate(
        name="x",
        question="q",
        dimension="framework",
        pipeline_labels=["default"],
        workspace_names=["ws1"],
    )
    with pytest.raises(ValidationError):
        ProjectCreate(
            name="x",
            question="q",
            dimension="framework",
            pipeline_labels=[],
            workspace_names=[],
        )


def test_project_create_name_max_length():
    ProjectCreate(name="x" * 200, question="q", dimension="d", pipeline_labels=["p"])
    with pytest.raises(ValidationError):
        ProjectCreate(name="x" * 201, question="q", dimension="d", pipeline_labels=["p"])


def test_workspace_file_upsert_content_max_length():
    """单文件内容上限 512KB"""
    WorkspaceFileUpsert(path="a.txt", content="x" * (512 * 1024))
    with pytest.raises(ValidationError):
        WorkspaceFileUpsert(path="a.txt", content="x" * (512 * 1024 + 1))


def test_workspace_file_upsert_path_min_length():
    with pytest.raises(ValidationError):
        WorkspaceFileUpsert(path="")


def test_pipeline_run_result_file_count_negative_rejected():
    with pytest.raises(ValidationError):
        PipelineRunResult(label="x", workspace="y", file_count=-1)


def test_pipeline_run_result_default_files_empty():
    r = PipelineRunResult(label="x", workspace="y")
    assert r.files == []
    assert r.file_count == 0