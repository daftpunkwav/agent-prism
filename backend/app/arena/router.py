"""维度路由 — 根据对比维度生成 PipelineConfig 列表。"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, Any

from app.arena.reasoning_graph import REASONING_MODES
from app.arena.types import DimensionId
from app.config import ProviderConfig, load_provider_config
from app.models import BaselineOverrides, PipelineConfig

if TYPE_CHECKING:
    from app.adapters.base import FrameworkAdapterRegistry

# 流水线默认值（控制变量法的基线）
DEFAULT_BASE: dict[str, Any] = {
    "framework": "langgraph",
    "reasoning": "react",
    "context": "sliding",
    "harness": "bare",
    "prompt_profile": "zero_shot",
    "prompt_version": "v1.0.0",
    "max_steps": 10,
    "toolset": "full",
    # endpoint_id / temperature / top_p 等运行时从 Provider 注入
}

# 维度 ID → PipelineConfig 字段名（对比时该字段变化，基线覆盖不得改它）
DIMENSION_FIELD: dict[DimensionId, str] = {
    "framework": "framework",
    "prompt": "prompt_profile",
    "reasoning": "reasoning",
    "context": "context",
    "harness": "harness",
    "temperature": "temperature",
    "model": "endpoint_id",
    "thinking": "thinking_level",
    "max_steps": "max_steps",
    "toolset": "toolset",
}

_ENDPOINT_FALLBACK = "default"
_MODEL_FALLBACK = "step-3.7-flash"

# sync_model_options 时填充：route/_base 按 id 取连接，避免仅磁盘 Provider 缺测试注入项
_ENDPOINT_CATALOG: dict[str, Any] = {}

# 仅基线、非对比维的解码控制变量
_BASELINE_ONLY_OPTIONS: dict[str, list[tuple[str, str]]] = {
    "top_p": [
        ("0.5", "0.5"),
        ("0.8", "0.8"),
        ("0.9", "0.9"),
        ("1", "1.0"),
    ],
    "frequency_penalty": [
        ("0", "0"),
        ("0.5", "0.5"),
        ("1", "1.0"),
    ],
    "presence_penalty": [
        ("0", "0"),
        ("0.5", "0.5"),
        ("1", "1.0"),
    ],
    "max_output_tokens": [
        ("512", "512"),
        ("1024", "1024"),
        ("2048", "2048"),
        ("4096", "4096"),
        ("8192", "8192"),
    ],
}

_BASELINE_ONLY_LABELS: dict[str, str] = {
    "top_p": "Top P",
    "frequency_penalty": "Frequency Penalty",
    "presence_penalty": "Presence Penalty",
    "max_output_tokens": "最大输出 tokens",
}

# 静态维度选项（framework / model 可被 sync 覆盖）
_STATIC_DIMENSION_OPTIONS: dict[DimensionId, list[tuple[str, str, str]]] = {
    "framework": [
        ("framework", "langchain", "LangChain"),
        ("framework", "langgraph", "LangGraph"),
    ],
    "prompt": [
        ("prompt_profile", "zero_shot", "Zero-shot"),
        ("prompt_profile", "few_shot", "Few-shot"),
        ("prompt_profile", "cot_prompt", "CoT Prompt"),
        ("prompt_profile", "structured", "Structured"),
    ],
    "reasoning": [
        ("reasoning", spec.mode, spec.label) for spec in REASONING_MODES.values()
    ],
    "context": [
        ("context", "sliding", "滑动窗口"),
        ("context", "summary", "摘要压缩"),
        ("context", "vector", "向量检索"),
        ("context", "hybrid", "混合策略"),
    ],
    "harness": [
        ("harness", "bare", "裸运行"),
        ("harness", "verify", "验证循环"),
        ("harness", "reflect", "反思循环"),
        ("harness", "self_evolve", "自进化"),
    ],
    "temperature": [
        ("temperature", "0", "0（确定性）"),
        ("temperature", "0.3", "0.3"),
        ("temperature", "0.7", "0.7"),
        ("temperature", "1", "1.0"),
    ],
    "model": [
        ("endpoint_id", _ENDPOINT_FALLBACK, f"{_MODEL_FALLBACK}（当前）"),
    ],
    "thinking": [
        ("thinking_level", "off", "关闭"),
        ("thinking_level", "low", "低"),
        ("thinking_level", "medium", "中"),
        ("thinking_level", "high", "高"),
    ],
    "max_steps": [
        ("max_steps", "5", "5 步"),
        ("max_steps", "10", "10 步"),
        ("max_steps", "15", "15 步"),
        ("max_steps", "20", "20 步"),
    ],
    "toolset": [
        ("toolset", "full", "全工具"),
        ("toolset", "code_file", "代码+文件"),
        ("toolset", "calc_time", "计算+时间"),
        ("toolset", "workspace_read", "只读工作区"),
    ],
}

# 可变视图：framework / model 可被 sync 覆盖
DIMENSION_OPTIONS: dict[DimensionId, list[tuple[str, str, str]]] = {
    k: list(v) for k, v in _STATIC_DIMENSION_OPTIONS.items()
}

# 支持的维度集合（用于 API 校验）
SUPPORTED_DIMENSIONS: frozenset[DimensionId] = frozenset(DIMENSION_OPTIONS.keys())

# 基线可覆盖字段及其合法取值
_BASELINE_OPTION_VALUES: dict[str, frozenset[str]] = {}

_FIELD_LABELS: dict[str, str] = {
    "framework": "框架",
    "prompt": "提示词",
    "reasoning": "推理模式",
    "context": "上下文",
    "harness": "Harness",
    "temperature": "温度",
    "model": "模型",
    "thinking": "思考强度",
    "max_steps": "最大步数",
    "toolset": "工具集",
}

# 基线 UI 分组（前端疏解拥挤）
_FIELD_GROUP: dict[str, str] = {
    "framework": "pipeline",
    "prompt_profile": "pipeline",
    "reasoning": "pipeline",
    "context": "pipeline",
    "harness": "pipeline",
    "toolset": "pipeline",
    "max_steps": "pipeline",
    "temperature": "decode",
    "top_p": "decode",
    "frequency_penalty": "decode",
    "presence_penalty": "decode",
    "max_output_tokens": "decode",
    "thinking_level": "decode",
    "endpoint_id": "access",
    "model_id": "access",
}


def _rebuild_baseline_option_values() -> None:
    """DIMENSION_OPTIONS / 仅基线选项变更后重建校验集合。"""
    global _BASELINE_OPTION_VALUES
    values: dict[str, frozenset[str]] = {
        DIMENSION_FIELD[dim]: frozenset(v for _, v, _ in opts)
        for dim, opts in DIMENSION_OPTIONS.items()
    }
    for field, opts in _BASELINE_ONLY_OPTIONS.items():
        values[field] = frozenset(v for v, _ in opts)
    _BASELINE_OPTION_VALUES = values


_rebuild_baseline_option_values()


def sync_framework_options_from_registry(registry: FrameworkAdapterRegistry) -> None:
    """用已注册 Adapter 覆盖 framework 维度选项，兑现「register 后 UI 可用」。"""
    available = registry.list_available()
    if not available:
        return
    DIMENSION_OPTIONS["framework"] = [
        ("framework", item["id"], item["name"]) for item in available
    ]
    _rebuild_baseline_option_values()
    ids = {item["id"] for item in available}
    if DEFAULT_BASE["framework"] not in ids:
        DEFAULT_BASE["framework"] = available[0]["id"]


def sync_model_options_from_provider(provider: ProviderConfig | None = None) -> None:
    """用接入点列表填充 model 维度（value=endpoint_id）。

    解码参数（temperature / top_p 等）写入 DEFAULT_BASE，对比模型时全员共用。
    """
    global _ENDPOINT_CATALOG
    cfg = provider or load_provider_config()
    endpoints = list(cfg.endpoints)
    if not endpoints:
        endpoints = [cfg.default_endpoint()]
    _ENDPOINT_CATALOG = {ep.id: ep for ep in endpoints}
    default_id = cfg.default_endpoint_id or endpoints[0].id
    opts: list[tuple[str, str, str]] = []
    for ep in endpoints:
        label = ep.display_label()
        if ep.id == default_id:
            label = f"{label}（当前）"
        opts.append(("endpoint_id", ep.id, label))
    DIMENSION_OPTIONS["model"] = opts
    DEFAULT_BASE["endpoint_id"] = default_id
    DEFAULT_BASE["model_id"] = (
        _ENDPOINT_CATALOG.get(default_id) or cfg.resolve_endpoint(default_id)
    ).model
    default_ep = _ENDPOINT_CATALOG.get(default_id) or cfg.resolve_endpoint(default_id)
    DEFAULT_BASE["thinking_level"] = (
        default_ep.thinking_level if default_ep.thinking_capable else "off"
    )
    DEFAULT_BASE["temperature"] = _snap_to_options(
        cfg.temperature, [0.0, 0.3, 0.7, 1.0]
    )
    DEFAULT_BASE["top_p"] = _snap_to_options(cfg.top_p, [0.5, 0.8, 0.9, 1.0])
    DEFAULT_BASE["frequency_penalty"] = _snap_to_options(
        cfg.frequency_penalty, [0.0, 0.5, 1.0]
    )
    DEFAULT_BASE["presence_penalty"] = _snap_to_options(
        cfg.presence_penalty, [0.0, 0.5, 1.0]
    )
    DEFAULT_BASE["max_output_tokens"] = _snap_int_to_options(
        cfg.max_output_tokens, [512, 1024, 2048, 4096, 8192]
    )
    _rebuild_baseline_option_values()


def _lookup_endpoint(endpoint_id: str | None, provider: ProviderConfig):
    """优先目录（含测试注入），再回退 Provider。"""
    if endpoint_id and endpoint_id in _ENDPOINT_CATALOG:
        return _ENDPOINT_CATALOG[endpoint_id]
    return provider.resolve_endpoint(endpoint_id)


def model_compare_ready() -> bool:
    """模型对比至少需要 2 个已配置接入点。"""
    return len(DIMENSION_OPTIONS.get("model") or []) >= 2


def _snap_to_options(value: float, allowed: list[float]) -> str:
    """吸附到离散档位（字符串）。"""
    best = min(allowed, key=lambda x: abs(x - float(value)))
    return f"{best:g}"


def _snap_int_to_options(value: int, allowed: list[int]) -> str:
    best = min(allowed, key=lambda x: abs(x - int(value)))
    return str(best)


def _snap_temperature(value: float) -> str:
    """兼容旧名。"""
    return _snap_to_options(value, [0.0, 0.3, 0.7, 1.0])


def reset_dimension_options() -> None:
    """测试用：恢复静态 DIMENSION_OPTIONS（清除 registry / provider 同步副作用）。"""
    global _ENDPOINT_CATALOG
    for key, opts in _STATIC_DIMENSION_OPTIONS.items():
        DIMENSION_OPTIONS[key] = list(opts)
    DEFAULT_BASE["framework"] = "langgraph"
    DEFAULT_BASE["max_steps"] = 10
    DEFAULT_BASE["toolset"] = "full"
    DEFAULT_BASE.pop("endpoint_id", None)
    DEFAULT_BASE.pop("model_id", None)
    DEFAULT_BASE.pop("temperature", None)
    DEFAULT_BASE.pop("thinking_level", None)
    DEFAULT_BASE.pop("top_p", None)
    DEFAULT_BASE.pop("frequency_penalty", None)
    DEFAULT_BASE.pop("presence_penalty", None)
    DEFAULT_BASE.pop("max_output_tokens", None)
    _ENDPOINT_CATALOG = {}
    _cached_provider.cache_clear()
    _rebuild_baseline_option_values()


@lru_cache(maxsize=1)
def _cached_provider() -> ProviderConfig:
    """单次请求内复用 provider 配置，避免每列重建 PipelineConfig 时重复读 JSON。"""
    return load_provider_config()


def invalidate_provider_cache() -> None:
    """Provider 配置更新后显式失效缓存，并刷新 model/解码默认。"""
    _cached_provider.cache_clear()
    sync_model_options_from_provider()


def _coerce_field_value(field: str, value: Any) -> Any:
    """把路由/基线中的字符串选项转为 PipelineConfig 可接受类型。"""
    if field in ("temperature", "top_p", "frequency_penalty", "presence_penalty"):
        return float(value)
    if field in ("max_steps", "max_output_tokens"):
        return int(value)
    return value


def _normalize_option_token(field: str, value: Any) -> str:
    """基线校验用：统一成选项 value 字符串。"""
    if field in ("temperature", "top_p", "frequency_penalty", "presence_penalty"):
        return f"{float(value):g}"
    if field in ("max_steps", "max_output_tokens"):
        return str(int(value))
    return str(value)


def _baseline_default_token(field_name: str) -> str:
    """list_baseline_fields 的 default，必须与 option.value 对齐。"""
    if field_name in (
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "max_output_tokens",
    ):
        raw = DEFAULT_BASE.get(field_name, "0" if field_name != "top_p" else "1")
        if field_name == "max_output_tokens" and field_name not in DEFAULT_BASE:
            raw = "2048"
        if field_name == "top_p" and field_name not in DEFAULT_BASE:
            raw = "1"
        return _normalize_option_token(field_name, raw)
    if field_name == "endpoint_id":
        return str(DEFAULT_BASE.get("endpoint_id") or _ENDPOINT_FALLBACK)
    if field_name == "model_id":
        return str(DEFAULT_BASE.get("model_id") or _MODEL_FALLBACK)
    if field_name == "max_steps":
        return str(int(DEFAULT_BASE.get("max_steps", 10)))
    if field_name in DEFAULT_BASE:
        return str(DEFAULT_BASE[field_name])
    for dim, fname in DIMENSION_FIELD.items():
        if fname == field_name and DIMENSION_OPTIONS.get(dim):
            return DIMENSION_OPTIONS[dim][0][1]
    return ""


def _ensure_model_synced(provider: ProviderConfig | None = None) -> None:
    if "model" not in DIMENSION_OPTIONS or not DIMENSION_OPTIONS["model"]:
        sync_model_options_from_provider(provider)
    elif DEFAULT_BASE.get("endpoint_id") is None:
        sync_model_options_from_provider(provider)


def _base(**overrides) -> PipelineConfig:
    provider = _cached_provider()
    _ensure_model_synced(provider)

    endpoint_id = overrides.get("endpoint_id") or DEFAULT_BASE.get("endpoint_id")
    ep = _lookup_endpoint(str(endpoint_id) if endpoint_id else None, provider)

    data: dict[str, Any] = {
        **DEFAULT_BASE,
        "endpoint_id": ep.id,
        "model_id": ep.model,
        "thinking_capable": ep.thinking_capable,
        "thinking_level": ep.effective_thinking_level(
            str(DEFAULT_BASE.get("thinking_level", "off"))
        ),
        "temperature": float(
            DEFAULT_BASE.get(
                "temperature", _snap_to_options(provider.temperature, [0.0, 0.3, 0.7, 1.0])
            )
        ),
        "top_p": float(DEFAULT_BASE.get("top_p", _snap_to_options(provider.top_p, [0.5, 0.8, 0.9, 1.0]))),
        "frequency_penalty": float(
            DEFAULT_BASE.get(
                "frequency_penalty",
                _snap_to_options(provider.frequency_penalty, [0.0, 0.5, 1.0]),
            )
        ),
        "presence_penalty": float(
            DEFAULT_BASE.get(
                "presence_penalty",
                _snap_to_options(provider.presence_penalty, [0.0, 0.5, 1.0]),
            )
        ),
        "max_output_tokens": int(
            DEFAULT_BASE.get(
                "max_output_tokens",
                _snap_int_to_options(provider.max_output_tokens, [512, 1024, 2048, 4096, 8192]),
            )
        ),
    }
    for key, value in overrides.items():
        if key == "label":
            data[key] = value
            continue
        if key == "endpoint_id":
            ep = _lookup_endpoint(str(value), provider)
            data["endpoint_id"] = ep.id
            data["model_id"] = ep.model
            data["thinking_capable"] = ep.thinking_capable
            continue
        if key == "model_id":
            if "endpoint_id" not in overrides:
                catalog = list(_ENDPOINT_CATALOG.values()) or list(provider.endpoints)
                matched = next((e for e in catalog if e.model == str(value)), None)
                if matched:
                    ep = matched
                    data["endpoint_id"] = matched.id
                    data["model_id"] = matched.model
                    data["thinking_capable"] = matched.thinking_capable
                else:
                    data["model_id"] = str(value)
            continue
        if key == "thinking_level":
            continue  # 循环后再按能力解析
        data[key] = _coerce_field_value(key, value)

    requested_level = overrides.get(
        "thinking_level", data.get("thinking_level", DEFAULT_BASE.get("thinking_level", "off"))
    )
    data["thinking_capable"] = bool(getattr(ep, "thinking_capable", False))
    data["thinking_level"] = ep.effective_thinking_level(str(requested_level))
    return PipelineConfig(**data)


def list_dimension_options(dimension: DimensionId) -> list[dict[str, str]]:
    """返回维度下所有可选项，供前端渲染。"""
    if dimension == "model":
        _ensure_model_synced()
    return [
        {"field": field, "value": value, "label": label}
        for field, value, label in DIMENSION_OPTIONS.get(dimension, [])
    ]


def list_baseline_fields() -> list[dict]:
    """返回基线可配置字段（含选项），供前端基线面板渲染。"""
    _ensure_model_synced()
    fields: list[dict] = []
    for dim_id, options in DIMENSION_OPTIONS.items():
        field_name = DIMENSION_FIELD[dim_id]
        fields.append(
            {
                "dimension": dim_id,
                "field": field_name,
                "label": _FIELD_LABELS.get(dim_id, dim_id),
                "group": _FIELD_GROUP.get(field_name, "pipeline"),
                "default": _baseline_default_token(field_name),
                "options": [{"value": v, "label": lab} for _, v, lab in options],
            }
        )
    for field_name, options in _BASELINE_ONLY_OPTIONS.items():
        fields.append(
            {
                "dimension": None,
                "field": field_name,
                "label": _BASELINE_ONLY_LABELS.get(field_name, field_name),
                "group": _FIELD_GROUP.get(field_name, "decode"),
                "default": _baseline_default_token(field_name),
                "options": [{"value": v, "label": lab} for v, lab in options],
            }
        )
    return fields


def _resolve_baseline_overrides(
    dimension: DimensionId,
    baseline: BaselineOverrides | dict | None,
) -> dict[str, Any]:
    """解析基线覆盖：忽略当前对比维字段；校验取值合法性。"""
    if baseline is None:
        return {}
    if isinstance(baseline, BaselineOverrides):
        raw = baseline.model_dump(exclude_none=True)
    else:
        raw = {k: v for k, v in baseline.items() if v is not None}

    # model_id → endpoint_id 兼容
    if "model_id" in raw and "endpoint_id" not in raw:
        mid = str(raw.pop("model_id"))
        catalog = list(_ENDPOINT_CATALOG.values()) or list(_cached_provider().endpoints)
        matched = next((e for e in catalog if e.model == mid), None)
        if matched:
            raw["endpoint_id"] = matched.id

    locked_field = DIMENSION_FIELD[dimension]
    resolved: dict[str, Any] = {}
    for key, value in raw.items():
        if key == locked_field:
            continue
        if key not in _BASELINE_OPTION_VALUES:
            raise ValueError(f"基线不支持字段: {key}")
        token = _normalize_option_token(key, value)
        if token not in _BASELINE_OPTION_VALUES[key]:
            raise ValueError(f"基线字段「{key}」不支持的取值: {value}")
        resolved[key] = _coerce_field_value(key, token)
    return resolved


class DimensionRouter:
    def route(
        self,
        dimension: DimensionId,
        selections: list[str] | None = None,
        baseline: BaselineOverrides | dict | None = None,
    ) -> list[PipelineConfig]:
        """根据维度 + 用户多选子项 + 可选基线覆盖生成 PipelineConfig 列表。

        selections: 该维度下用户选中的 value 列表；None/空 表示选全部。
        baseline: 非对比维的固定值覆盖（对比维字段会被忽略）。
        至少返回 2 个 PipelineConfig，否则抛 ValueError。
        """
        if dimension == "model":
            _ensure_model_synced()

        options = DIMENSION_OPTIONS.get(dimension)
        if options is None:
            raise ValueError(f"未知维度: {dimension}")

        chosen = list(dict.fromkeys(selections)) if selections else [value for _, value, _ in options]
        if len(chosen) < 2:
            raise ValueError(f"维度「{dimension}」至少需选择 2 个对比项，当前 {len(chosen)} 个")

        base_overrides = _resolve_baseline_overrides(dimension, baseline)

        by_value = {value: (field, label) for field, value, label in options}
        configs: list[PipelineConfig] = []
        for value in chosen:
            if value not in by_value:
                raise ValueError(f"维度「{dimension}」不支持的子项: {value}")
            field, label = by_value[value]
            configs.append(
                _base(
                    **base_overrides,
                    **{field: _coerce_field_value(field, value)},
                    label=label,
                )
            )
        return configs

    def column_count(self, dimension: DimensionId, selections: list[str] | None = None) -> int:
        return len(self.route(dimension, selections))
