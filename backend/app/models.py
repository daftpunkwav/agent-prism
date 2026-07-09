"""Arena 领域模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.arena.types import (
    ApiFormat,
    DimensionId,
    EventType,
    HarnessLevel,
    PromptProfile,
)

__all__ = [
    "DimensionId",
    "PromptProfile",
    "EventType",
    "PipelineConfig",
    "ArenaRunRequest",
    "PipelineMetrics",
    "ArenaEvent",
    "ProviderConfigPublic",
    "ProviderConfigUpdate",
    "ConnectionTestResult",
    "Project",
    "ProjectCreate",
    "WorkspaceFileUpsert",
    "PipelineRunResult",
]


class PipelineConfig(BaseModel):
    framework: str = "langgraph"
    reasoning: str = "react"
    context: str = "sliding"
    harness: HarnessLevel = "bare"
    prompt_profile: PromptProfile = "zero_shot"
    model_id: str = "step-3.7-flash"
    temperature: float = 0.0
    prompt_version: str = "v1.0.0"
    label: str = ""


class ArenaRunRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dimension: DimensionId = "framework"
    # 该维度下用户选中的子项 value 列表；空 = 全选，但至少 2 项（router 校验）
    selections: list[str] = Field(default_factory=list, max_length=20)
    temperature: float | None = None


class PipelineMetrics(BaseModel):
    success: bool
    duration_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    tool_calls: int = 0
    steps: int = 0
    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048
    context_usage_pct: float = 0.0
    input_usage_pct: float = 0.0


class ArenaEvent(BaseModel):
    type: EventType
    pipeline: str
    # 工作空间名称（仅 complete/token_update 阶段填写，供前端定位文件）
    workspace: str = ""
    content: str = ""
    tool: str = ""
    args: dict[str, Any] = Field(default_factory=dict)
    result: str = ""
    step: int = 0
    passed: bool | None = None
    reason: str = ""
    metrics: PipelineMetrics | None = None
    message: str = ""
    token_stats: dict[str, int | float] | None = None


class ProviderConfigPublic(BaseModel):
    """返回给前端的配置（API Key 脱敏）。"""

    provider_name: str
    notes: str
    website_url: str
    api_key_set: bool
    api_key_preview: str
    base_url: str
    use_full_url: bool
    api_format: str
    auth_field: str
    model: str
    temperature: float
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    context_window: int
    max_input_tokens: int
    max_output_tokens: int


class ProviderConfigUpdate(BaseModel):
    """Provider 配置更新请求体。api_key 留空 = 保持已保存的值。"""

    provider_name: str = "StepFun"
    notes: str = ""
    website_url: str = ""
    # 空字符串表示"不更新 API Key"（后端保留旧值）
    api_key: str = Field(default="", max_length=256)
    base_url: str = ""
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = "ANTHROPIC_AUTH_TOKEN"
    model: str = "step-3.7-flash"
    temperature: float = 0.0
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str
    model: str = ""


# ===== 项目管理模型 =====


class PipelineRunResult(BaseModel):
    """单条 Pipeline 运行结果。"""

    label: str
    workspace: str
    file_count: int = 0
    files: list[str] = Field(default_factory=list)


class Project(BaseModel):
    id: str
    name: str
    question: str
    dimension: str
    created_at: str
    # Pipeline 运行结果列表
    results: list[PipelineRunResult] = Field(default_factory=list)
    # workspace_files: {workspace_name: {file_path: content}}
    workspace_files: dict[str, dict[str, str]] = Field(default_factory=dict)
    metrics_summary: dict[str, dict] = Field(default_factory=dict)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=8000)
    dimension: str = Field(min_length=1, max_length=50)
    pipeline_labels: list[str] = Field(default_factory=list, max_length=10)
    workspace_names: list[str] = Field(default_factory=list)


class WorkspaceFileUpsert(BaseModel):
    """工作空间文件保存请求体。"""

    path: str = Field(min_length=1, max_length=500)
    content: str = ""
    create_only: bool = False
