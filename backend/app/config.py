"""应用配置：从 .env 与用户配置 JSON 加载 BYOK 设置。"""

from __future__ import annotations

import json
import uuid
from functools import cached_property
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.arena.types import ApiFormat, ThinkingLevel
from app.storage import atomic_write_json

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROVIDER_CONFIG_PATH = DATA_DIR / "provider_config.json"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider_name: str = "StepFun"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.stepfun.com/step_plan"
    llm_model: str = "step-3.7-flash"
    llm_api_format: ApiFormat = "anthropic_messages"
    llm_temperature: float = 0.0
    backend_host: str = "127.0.0.1"
    # 默认 8000；若 8000 被占用可通过环境变量或启动参数覆盖
    backend_port: int = 8000
    # CORS 允许的前端 origin，逗号分隔
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # 请求体大小上限（字节），超过返回 413
    max_request_size: int = 10 * 1024 * 1024
    # 可选 API Token；非空时除 /api/health 外需 Bearer / X-API-Token
    api_token: str = ""
    # 同时进行的 Arena run 上限（防止无认证时成本/资源耗尽）
    max_concurrent_runs: int = 4

    @cached_property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


def new_endpoint_id() -> str:
    """生成短稳定槽位 id。"""
    return uuid.uuid4().hex[:12]


def normalize_base_url(url: str) -> str:
    """规范化 base_url，用于同连接去重。"""
    return (url or "").strip().rstrip("/").lower()


def normalize_model_ids(primary: str, extras: list[str] | None = None) -> list[str]:
    """主模型 + 对比列表去重保序；空串丢弃（兼容旧测试/调用）。"""
    out: list[str] = []
    seen: set[str] = set()
    for raw in [primary, *(extras or [])]:
        mid = (raw or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(mid)
    return out


class LlmEndpoint(BaseModel):
    """单条 LLM 接入点：连接信息 + model id（解码参数不在此，走统一基线）。"""

    id: str = Field(default_factory=new_endpoint_id, min_length=1, max_length=64)
    label: str = Field(default="", max_length=100)
    provider_name: str = Field(default="", max_length=100)
    api_key: str = Field(default="", max_length=4096)
    base_url: str = Field(default="https://api.stepfun.com/step_plan", max_length=500)
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = Field(default="ANTHROPIC_AUTH_TOKEN", max_length=100)
    model: str = Field(default="step-3.7-flash", max_length=200)
    # 能力元数据（Token 统计 / UI）；Arena 对比时生成上限仍以统一基线为准
    context_window: int = Field(default=128_000, ge=1024, le=10_000_000)
    max_input_tokens: int = Field(default=120_000, ge=256, le=10_000_000)
    max_output_tokens: int = Field(default=2048, ge=64, le=128_000)
    website_url: str = Field(default="", max_length=500)
    # 思考能力：不支持时 Arena 强制 off；支持时可用基线/维度档位
    thinking_capable: bool = False
    thinking_level: ThinkingLevel = "off"

    @field_validator("model", "id")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("不能为空")
        return s

    def display_label(self) -> str:
        """Arena / UI 展示名。"""
        base = (self.label or "").strip() or self.model
        return base

    def effective_thinking_level(self, requested: ThinkingLevel | str) -> ThinkingLevel:
        """结合能力开关解析实际思考档位。"""
        if not self.thinking_capable:
            return "off"
        lvl = requested if requested in ("off", "low", "medium", "high") else "off"
        return lvl  # type: ignore[return-value]


def _legacy_endpoints_from_dict(data: dict[str, Any]) -> list[dict[str, Any]]:
    """无 endpoints 时：顶层连接 + 旧 models[] → 多条同连接接入点。"""
    primary_id = new_endpoint_id()
    primary = {
        "id": primary_id,
        "label": "",
        "provider_name": data.get("provider_name") or "StepFun",
        "api_key": data.get("api_key") or "",
        "base_url": data.get("base_url") or "https://api.stepfun.com/step_plan",
        "use_full_url": data.get("use_full_url", True),
        "api_format": data.get("api_format") or "anthropic_messages",
        "auth_field": data.get("auth_field") or "ANTHROPIC_AUTH_TOKEN",
        "model": (data.get("model") or "step-3.7-flash").strip(),
        "context_window": data.get("context_window", 128_000),
        "max_input_tokens": data.get("max_input_tokens", 120_000),
        "max_output_tokens": data.get("max_output_tokens", 2048),
        "website_url": data.get("website_url") or "",
    }
    endpoints = [primary]
    extras = data.get("models") or []
    if isinstance(extras, list):
        primary_model = primary["model"]
        for item in extras:
            mid = str(item).strip() if not isinstance(item, dict) else str(
                item.get("model") or item.get("model_id") or ""
            ).strip()
            if not mid or mid == primary_model:
                continue
            endpoints.append(
                {
                    **primary,
                    "id": new_endpoint_id(),
                    "label": mid,
                    "model": mid,
                }
            )
    return endpoints


class ProviderConfig(BaseModel):
    """运行时 BYOK 配置：多接入点 + 共享解码默认。"""

    notes: str = ""
    website_url: str = "https://platform.stepfun.com/step-plan"
    endpoints: list[LlmEndpoint] = Field(default_factory=list, max_length=12)
    default_endpoint_id: str = ""
    # 共享解码默认（Arena 基线种子；对比模型时全员同一套）
    temperature: float = 0.0
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    max_output_tokens: int = 2048
    # —— 以下为默认接入点镜像，兼容 ExperimentPanel / 旧调用 ——
    provider_name: str = "StepFun"
    api_key: str = ""
    base_url: str = "https://api.stepfun.com/step_plan"
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = "ANTHROPIC_AUTH_TOKEN"
    model: str = "step-3.7-flash"
    models: list[str] = Field(default_factory=list, max_length=12)
    context_window: int = 128_000
    max_input_tokens: int = 120_000

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        raw = dict(data)
        endpoints = raw.get("endpoints")
        if not endpoints:
            built = _legacy_endpoints_from_dict(raw)
            raw["endpoints"] = built
            raw["default_endpoint_id"] = built[0]["id"]
        return raw

    @model_validator(mode="after")
    def _normalize_endpoints(self) -> ProviderConfig:
        if not self.endpoints:
            eid = new_endpoint_id()
            self.endpoints = [
                LlmEndpoint(
                    id=eid,
                    provider_name=self.provider_name or "StepFun",
                    api_key=self.api_key,
                    base_url=self.base_url,
                    use_full_url=self.use_full_url,
                    api_format=self.api_format,
                    auth_field=self.auth_field,
                    model=self.model or "step-3.7-flash",
                    context_window=self.context_window,
                    max_input_tokens=self.max_input_tokens,
                    max_output_tokens=self.max_output_tokens,
                    website_url=self.website_url or "",
                )
            ]
            self.default_endpoint_id = eid

        # id 去重
        seen_ids: set[str] = set()
        unique: list[LlmEndpoint] = []
        for ep in self.endpoints:
            if ep.id in seen_ids:
                ep = ep.model_copy(update={"id": new_endpoint_id()})
            seen_ids.add(ep.id)
            unique.append(ep)
        self.endpoints = unique

        # 同 (base_url, api_format) 下禁止重复 model
        conn_models: dict[tuple[str, str], set[str]] = {}
        for ep in self.endpoints:
            key = (normalize_base_url(ep.base_url), str(ep.api_format))
            bucket = conn_models.setdefault(key, set())
            mid = ep.model.strip()
            if mid in bucket:
                raise ValueError(
                    f"同一请求地址下模型「{mid}」重复，请合并或改用不同 model id"
                )
            bucket.add(mid)

        if not self.default_endpoint_id or self.default_endpoint_id not in {
            e.id for e in self.endpoints
        }:
            self.default_endpoint_id = self.endpoints[0].id

        # 镜像默认接入点到顶层（兼容旧字段）
        default = self.get_endpoint(self.default_endpoint_id) or self.endpoints[0]
        self.provider_name = default.provider_name or self.provider_name
        self.api_key = default.api_key
        self.base_url = default.base_url
        self.use_full_url = default.use_full_url
        self.api_format = default.api_format
        self.auth_field = default.auth_field
        self.model = default.model
        self.context_window = default.context_window
        self.max_input_tokens = default.max_input_tokens
        if default.website_url:
            self.website_url = default.website_url
        # 派生旧 models 列表（不含默认），便于过渡期
        self.models = [
            e.model for e in self.endpoints if e.id != self.default_endpoint_id
        ]
        return self

    def get_endpoint(self, endpoint_id: str | None) -> LlmEndpoint | None:
        """按 id 查找接入点。"""
        if not endpoint_id:
            return None
        for ep in self.endpoints:
            if ep.id == endpoint_id:
                return ep
        return None

    def default_endpoint(self) -> LlmEndpoint:
        """默认接入点。"""
        ep = self.get_endpoint(self.default_endpoint_id)
        return ep or self.endpoints[0]

    def resolve_endpoint(self, endpoint_id: str | None = None) -> LlmEndpoint:
        """解析接入点；无效 id 回退默认。"""
        if endpoint_id:
            found = self.get_endpoint(endpoint_id)
            if found:
                return found
        return self.default_endpoint()

    def comparison_model_ids(self) -> list[str]:
        """各接入点 model id 列表（去重保序）。"""
        return normalize_model_ids(
            self.endpoints[0].model if self.endpoints else self.model,
            [e.model for e in self.endpoints[1:]],
        )


def merge_endpoint_keys(
    incoming: list[LlmEndpoint],
    current: list[LlmEndpoint],
) -> list[LlmEndpoint]:
    """更新时：空 api_key 保留同 id 已存 key；新 id 可继承同连接已有 key。"""
    by_id = {e.id: e for e in current}
    # 同连接指纹 → 任一已存 key
    conn_key: dict[tuple[str, str], str] = {}
    for e in current:
        if e.api_key:
            conn_key[(normalize_base_url(e.base_url), str(e.api_format))] = e.api_key
    for e in incoming:
        if e.api_key:
            conn_key[(normalize_base_url(e.base_url), str(e.api_format))] = e.api_key

    merged: list[LlmEndpoint] = []
    for ep in incoming:
        key = ep.api_key
        if not key and ep.id in by_id and by_id[ep.id].api_key:
            key = by_id[ep.id].api_key
        if not key:
            key = conn_key.get((normalize_base_url(ep.base_url), str(ep.api_format)), "")
        if key != ep.api_key:
            ep = ep.model_copy(update={"api_key": key})
        merged.append(ep)
    return merged


def load_provider_config() -> ProviderConfig:
    """优先读取 data/provider_config.json，否则回退到 .env。"""
    if PROVIDER_CONFIG_PATH.exists():
        data = json.loads(PROVIDER_CONFIG_PATH.read_text(encoding="utf-8"))
        return ProviderConfig(**data)

    return ProviderConfig(
        provider_name=settings.llm_provider_name,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_format=settings.llm_api_format,
        temperature=settings.llm_temperature,
    )


def save_provider_config(config: ProviderConfig) -> None:
    """原子写入 provider_config.json；旧版本备份到 provider_config.json.bak。"""
    atomic_write_json(PROVIDER_CONFIG_PATH, json.loads(config.model_dump_json()))
