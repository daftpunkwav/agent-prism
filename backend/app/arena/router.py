"""维度路由 — 根据对比维度生成 PipelineConfig 列表。"""

from __future__ import annotations

from functools import lru_cache

from app.arena.reasoning_graph import REASONING_MODES
from app.arena.types import DimensionId
from app.config import ProviderConfig, load_provider_config
from app.models import BaselineOverrides, PipelineConfig

# 流水线默认值（控制变量法的基线）
DEFAULT_BASE: dict = {
    "framework": "langgraph",
    "reasoning": "react",
    "context": "sliding",
    "harness": "bare",
    "prompt_profile": "zero_shot",
    "prompt_version": "v1.0.0",
}

# 维度 ID → PipelineConfig 字段名（对比时该字段变化，基线覆盖不得改它）
DIMENSION_FIELD: dict[DimensionId, str] = {
    "framework": "framework",
    "prompt": "prompt_profile",
    "reasoning": "reasoning",
    "context": "context",
    "harness": "harness",
}

# 每个维度下可选项的元组 (字段名, 取值, 显示标签)
DIMENSION_OPTIONS: dict[DimensionId, list[tuple[str, str, str]]] = {
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
}

# 支持的维度集合（用于 API 校验）
SUPPORTED_DIMENSIONS: frozenset[DimensionId] = frozenset(DIMENSION_OPTIONS.keys())

# 基线可覆盖字段及其合法取值
_BASELINE_OPTION_VALUES: dict[str, frozenset[str]] = {
    DIMENSION_FIELD[dim]: frozenset(v for _, v, _ in opts) for dim, opts in DIMENSION_OPTIONS.items()
}


@lru_cache(maxsize=1)
def _cached_provider() -> ProviderConfig:
    """单次请求内复用 provider 配置，避免每列重建 PipelineConfig 时重复读 JSON。

    Provider 设置更新时应调用 :func:`_invalidate_provider_cache`。
    """
    return load_provider_config()


def invalidate_provider_cache() -> None:
    """Provider 配置更新后显式失效缓存。供 settings API 调用。"""
    _cached_provider.cache_clear()


def _base(**overrides) -> PipelineConfig:
    provider = _cached_provider()
    data = {
        **DEFAULT_BASE,
        "model_id": provider.model,
        "temperature": provider.temperature,
        **overrides,
    }
    return PipelineConfig(**data)


def list_dimension_options(dimension: DimensionId) -> list[dict[str, str]]:
    """返回维度下所有可选项，供前端 checkbox 渲染。"""
    return [{"field": field, "value": value, "label": label} for field, value, label in DIMENSION_OPTIONS.get(dimension, [])]


def list_baseline_fields() -> list[dict]:
    """返回基线可配置字段（含选项），供前端基线面板渲染。"""
    fields: list[dict] = []
    for dim_id, options in DIMENSION_OPTIONS.items():
        field_name = DIMENSION_FIELD[dim_id]
        labels = {
            "framework": "框架",
            "prompt": "提示词",
            "reasoning": "推理模式",
            "context": "上下文",
            "harness": "Harness",
        }
        fields.append(
            {
                "dimension": dim_id,
                "field": field_name,
                "label": labels.get(dim_id, dim_id),
                "default": DEFAULT_BASE.get(field_name),
                "options": [{"value": v, "label": lab} for _, v, lab in options],
            }
        )
    return fields


def _resolve_baseline_overrides(
    dimension: DimensionId,
    baseline: BaselineOverrides | dict | None,
) -> dict[str, str]:
    """解析基线覆盖：忽略当前对比维字段；校验取值合法性。"""
    if baseline is None:
        return {}
    if isinstance(baseline, BaselineOverrides):
        raw = baseline.model_dump(exclude_none=True)
    else:
        raw = {k: v for k, v in baseline.items() if v is not None}

    locked_field = DIMENSION_FIELD[dimension]
    resolved: dict[str, str] = {}
    for key, value in raw.items():
        if key == locked_field:
            continue
        if key not in _BASELINE_OPTION_VALUES:
            raise ValueError(f"基线不支持字段: {key}")
        if value not in _BASELINE_OPTION_VALUES[key]:
            raise ValueError(f"基线字段「{key}」不支持的取值: {value}")
        resolved[key] = value
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
        options = DIMENSION_OPTIONS.get(dimension)
        if options is None:
            raise ValueError(f"未知维度: {dimension}")

        # 去重保序：重复 selections 不应产生重复 pipeline（避免双倍 LLM 成本）
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
            configs.append(_base(**base_overrides, **{field: value}, label=label))
        return configs

    def column_count(self, dimension: DimensionId, selections: list[str] | None = None) -> int:
        return len(self.route(dimension, selections))
