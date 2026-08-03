"""Arena 领域模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.arena.types import (
    ApiFormat,
    ContextStrategy,
    DimensionId,
    EventType,
    HarnessLevel,
    PromptProfile,
    ReasoningMode,
    ThinkingLevel,
    ToolsetId,
)
from app.arena.url_validate import validate_llm_base_url, validate_website_url

__all__ = [
    "DimensionId",
    "PromptProfile",
    "EventType",
    "PipelineConfig",
    "BaselineOverrides",
    "ChatMessage",
    "ArenaRunRequest",
    "PipelineMetrics",
    "ArenaEvent",
    "LlmEndpointPublic",
    "LlmEndpointUpdate",
    "ProviderConfigPublic",
    "ProviderConfigUpdate",
    "ConnectionTestResult",
    "PipelineRunResult",
    "Project",
    "ProjectCreate",
    "WorkspaceFileUpsert",
    "JudgeRequest",
]


class PipelineConfig(BaseModel):
    framework: str = "langgraph"
    reasoning: ReasoningMode = "react"
    context: ContextStrategy = "sliding"
    harness: HarnessLevel = "bare"
    prompt_profile: PromptProfile = "zero_shot"
    endpoint_id: str = ""
    model_id: str = "step-3.7-flash"
    temperature: float = 0.0
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    max_output_tokens: int = Field(default=2048, ge=64, le=128_000)
    thinking_level: ThinkingLevel = "off"
    thinking_capable: bool = False
    max_steps: int = Field(default=10, ge=1, le=40)
    toolset: ToolsetId = "full"
    prompt_version: str = "v1.0.0"
    label: str = ""


class BaselineOverrides(BaseModel):
    """控制变量基线覆盖 — 仅影响非当前对比维度的固定字段。"""

    framework: str | None = None
    reasoning: str | None = None
    context: str | None = None
    harness: HarnessLevel | None = None
    prompt_profile: PromptProfile | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    endpoint_id: str | None = None
    model_id: str | None = None  # 兼容旧客户端；优先 endpoint_id
    thinking_level: ThinkingLevel | None = None
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    max_output_tokens: int | None = Field(default=None, ge=64, le=128_000)
    max_steps: int | None = Field(default=None, ge=1, le=40)
    toolset: ToolsetId | None = None


class ChatMessage(BaseModel):
    """多轮对话中的一条历史消息（不含本轮 question）。"""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ArenaRunRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dimension: DimensionId = "framework"
    # 该维度下用户选中的子项 value 列表；空 = 全选，但至少 2 项（router 校验）
    selections: list[str] = Field(default_factory=list, max_length=16)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    # 非对比维的基线覆盖（如框架对比时改用 tot 推理）
    baseline: BaselineOverrides | None = None
    # 共享对话历史（各列同一上下文）；仅含本轮之前的 user/assistant
    messages: list[ChatMessage] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def _validate_history(self) -> ArenaRunRequest:
        """限制历史总长，并要求 user/assistant 交替成对。"""
        msgs = self.messages
        if len(msgs) % 2 != 0:
            raise ValueError("对话历史须成对（user/assistant），条数须为偶数")
        for i, m in enumerate(msgs):
            expect = "user" if i % 2 == 0 else "assistant"
            if m.role != expect:
                raise ValueError(
                    f"对话历史第 {i + 1} 条应为 {expect}，实际为 {m.role}"
                )
        total = sum(len(m.content) for m in msgs) + len(self.question)
        if total > 24_000:
            raise ValueError("对话历史与本轮问题合计超过上限（24000 字符）")
        return self


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
    # 工作空间名称（仅在 complete / token_update 等终结事件携带）
    # 前端用它直接打开对应 Agent 的工作空间侧栏
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
    # 多轮对话轮次（1-based）；0 表示单轮/未标注
    turn: int = Field(default=0, ge=0, le=64)


class LlmEndpointPublic(BaseModel):
    """接入点公开视图（API Key 脱敏）。"""

    id: str
    label: str = ""
    provider_name: str = ""
    api_key_set: bool = False
    api_key_preview: str = ""
    base_url: str
    use_full_url: bool = True
    api_format: str
    auth_field: str
    model: str
    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048
    website_url: str = ""
    thinking_capable: bool = False
    thinking_level: str = "off"


class LlmEndpointUpdate(BaseModel):
    """接入点更新；``api_key`` 空串表示保留已存 key。"""

    id: str = Field(default="", max_length=64)
    label: str = Field(default="", max_length=100)
    provider_name: str = Field(default="", max_length=100)
    api_key: str = Field(default="", max_length=4096)
    base_url: str = Field(default="", max_length=500)
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = Field(default="ANTHROPIC_AUTH_TOKEN", max_length=100)
    model: str = Field(default="step-3.7-flash", max_length=200)
    context_window: int = Field(default=128_000, ge=1024, le=10_000_000)
    max_input_tokens: int = Field(default=120_000, ge=256, le=10_000_000)
    max_output_tokens: int = Field(default=2048, ge=64, le=128_000)
    website_url: str = Field(default="", max_length=500)
    thinking_capable: bool = False
    thinking_level: ThinkingLevel = "off"

    @field_validator("base_url")
    @classmethod
    def _check_base_url(cls, v: str) -> str:
        if not (v or "").strip():
            return v
        return validate_llm_base_url(v)

    @field_validator("website_url")
    @classmethod
    def _check_website_url(cls, v: str) -> str:
        if not (v or "").strip():
            return ""
        return validate_website_url(v)


class ProviderConfigPublic(BaseModel):
    """返回给前端的配置（API Key 脱敏）。"""

    notes: str
    website_url: str
    endpoints: list[LlmEndpointPublic] = Field(default_factory=list)
    default_endpoint_id: str = ""
    temperature: float
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    max_output_tokens: int
    # 默认接入点镜像（ExperimentPanel / 旧 UI）
    provider_name: str
    api_key_set: bool
    api_key_preview: str
    base_url: str
    use_full_url: bool
    api_format: str
    auth_field: str
    model: str
    models: list[str] = Field(default_factory=list)
    context_window: int
    max_input_tokens: int


class ProviderConfigUpdate(BaseModel):
    """Provider 配置更新请求体。

    优先使用 ``endpoints``；若为空则回退到顶层单连接字段（兼容旧客户端）。
    接入点 / 顶层 ``api_key`` 留空表示保留已保存的 key。
    """

    notes: str = Field(default="", max_length=500)
    website_url: str = Field(default="", max_length=500)
    endpoints: list[LlmEndpointUpdate] = Field(default_factory=list, max_length=12)
    default_endpoint_id: str = Field(default="", max_length=64)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    max_output_tokens: int = Field(default=2048, ge=64, le=128_000)
    # 兼容旧扁平字段 / ExperimentPanel
    provider_name: str = Field(default="StepFun", max_length=100)
    api_key: str = Field(default="", max_length=4096)
    base_url: str = Field(default="", max_length=500)
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = Field(default="ANTHROPIC_AUTH_TOKEN", max_length=100)
    model: str = Field(default="step-3.7-flash", max_length=200)
    models: list[str] = Field(default_factory=list, max_length=12)
    context_window: int = Field(default=128_000, ge=1024, le=10_000_000)
    max_input_tokens: int = Field(default=120_000, ge=256, le=10_000_000)
    # 测连时可指定接入点
    test_endpoint_id: str = Field(default="", max_length=64)

    @field_validator("website_url")
    @classmethod
    def _check_website_url(cls, v: str) -> str:
        return validate_website_url(v)

    @field_validator("base_url")
    @classmethod
    def _check_base_url(cls, v: str) -> str:
        if not (v or "").strip():
            return v
        return validate_llm_base_url(v)

    @field_validator("models")
    @classmethod
    def _clean_models(cls, v: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in v or []:
            mid = str(item).strip()
            if not mid or mid in seen:
                continue
            if len(mid) > 200:
                raise ValueError("模型 id 过长")
            seen.add(mid)
            cleaned.append(mid)
        return cleaned


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str
    model: str = ""


# ===== 项目管理模型 =====


class PipelineRunResult(BaseModel):
    """单条 Pipeline 运行结果（在 Project.results 中）。"""

    label: str
    workspace: str
    file_count: int = Field(default=0, ge=0)
    files: list[str] = Field(default_factory=list)


class Project(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    question: str = Field(max_length=8000)
    dimension: str = Field(max_length=50)
    created_at: str = Field(max_length=64)
    results: list[PipelineRunResult] = Field(default_factory=list)
    # workspace_files: {workspace_name: {file_path: content}} — 嵌套映射
    workspace_files: dict[str, dict[str, str]] = Field(default_factory=dict)
    metrics_summary: dict[str, dict[str, float]] = Field(default_factory=dict)


class ProjectCreate(BaseModel):
    """项目创建请求。

    ``pipeline_labels`` 与 ``workspace_names`` 一一对应（同 index 即同一管线）。
    两者至少需要 1 个；``workspace_names`` 留空时用 ``pipeline_labels`` 兜底。
    """

    name: str = Field(min_length=1, max_length=200)
    question: str = Field(max_length=8000)
    dimension: str = Field(max_length=50)
    pipeline_labels: list[str] = Field(min_length=1, max_length=16)
    workspace_names: list[str] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def _validate_label_workspace_consistency(self) -> ProjectCreate:
        """workspace_names 为空时回退到 pipeline_labels，保证两者都有内容。"""
        if not self.workspace_names:
            self.workspace_names = list(self.pipeline_labels)
        return self


class WorkspaceFileUpsert(BaseModel):
    """工作空间文件保存请求体。"""

    path: str = Field(min_length=1, max_length=512)
    content: str = Field(default="", max_length=512 * 1024)
    create_only: bool = False


class JudgeRequest(BaseModel):
    """判分请求：template_id + {label: 最终答案文本}。"""

    template_id: str = Field(min_length=1, max_length=100)
    answers: dict[str, str] = Field(default_factory=dict, max_length=16)
