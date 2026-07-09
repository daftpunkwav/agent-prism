"""Arena 领域模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DimensionId = Literal["framework", "prompt", "reasoning", "context", "harness"]
PromptProfile = Literal["zero_shot", "few_shot", "cot_prompt", "structured"]

# EventType 增加 "thinking" 用于解析 Anthropic extended thinking 块
EventType = Literal[
    "thought",
    "action",
    "observation",
    "verify",
    "reflect",
    "complete",
    "error",
    "token_update",
    "thinking",
]


class PipelineConfig(BaseModel):
    framework: str = "langgraph"
    reasoning: str = "react"
    context: str = "sliding"
    harness: str = "bare"
    prompt_profile: PromptProfile = "zero_shot"
    model_id: str = "step-3.7-flash"
    temperature: float = 0.0
    prompt_version: str = "v1.0.0"
    label: str = ""


class ArenaRunRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dimension: DimensionId = "framework"
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
    context_window: int
    max_input_tokens: int
    max_output_tokens: int


class ProviderConfigUpdate(BaseModel):
    provider_name: str = "StepFun"
    notes: str = ""
    website_url: str = ""
    api_key: str = ""
    base_url: str = ""
    use_full_url: bool = True
    api_format: Literal["anthropic_messages", "openai_chat"] = "anthropic_messages"
    auth_field: str = "ANTHROPIC_AUTH_TOKEN"
    model: str = "step-3.7-flash"
    temperature: float = 0.0
    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str
    model: str = ""


# ===== 项目管理模型 =====


class Project(BaseModel):
    id: str
    name: str
    question: str
    dimension: str
    created_at: str
    results: list[dict] = Field(default_factory=list)
    workspace_files: dict[str, str] = Field(default_factory=dict)
    metrics_summary: dict[str, dict] = Field(default_factory=dict)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    question: str
    dimension: str
    pipeline_labels: list[str]
    workspace_names: list[str] = Field(default_factory=list)
