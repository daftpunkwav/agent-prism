"""维度路由 — 根据对比维度生成 PipelineConfig 列表。"""

from __future__ import annotations

from functools import lru_cache

from app.config import ProviderConfig, load_provider_config
from app.models import DimensionId, PipelineConfig

DEFAULT_BASE: dict = {
    "framework": "langgraph",
    "reasoning": "react",
    "context": "sliding",
    "harness": "bare",
    "prompt_profile": "zero_shot",
    "prompt_version": "v1.0.0",
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
        ("reasoning", "react", "ReAct"),
        ("reasoning", "cot_tool", "CoT+Tool"),
        ("reasoning", "tot", "ToT"),
        ("reasoning", "reflexion", "Reflexion"),
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


@lru_cache(maxsize=1)
def _cached_provider() -> ProviderConfig:
    """单次请求内复用 provider 配置，避免每列重建 PipelineConfig 时重复读 JSON。"""
    return load_provider_config()


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
    return [
        {"field": field, "value": value, "label": label}
        for field, value, label in DIMENSION_OPTIONS.get(dimension, [])
    ]


class DimensionRouter:
    def route(
        self,
        dimension: DimensionId,
        selections: list[str] | None = None,
    ) -> list[PipelineConfig]:
        """根据维度 + 用户多选子项生成 PipelineConfig 列表。

        selections: 该维度下用户选中的 value 列表；None/空 表示选全部。
        至少返回 2 个 PipelineConfig，否则抛 ValueError。
        """
        options = DIMENSION_OPTIONS.get(dimension)
        if options is None:
            raise ValueError(f"未知维度: {dimension}")

        chosen = selections if selections else [value for _, value, _ in options]
        if len(chosen) < 2:
            raise ValueError(f"维度「{dimension}」至少需选择 2 个对比项，当前 {len(chosen)} 个")

        # 用 dict 保留用户传入顺序，便于稳定列序
        by_value = {value: (field, label) for field, value, label in options}
        configs: list[PipelineConfig] = []
        for value in chosen:
            if value not in by_value:
                raise ValueError(f"维度「{dimension}」不支持的子项: {value}")
            field, label = by_value[value]
            configs.append(_base(**{field: value}, label=label))
        return configs

    def column_count(
        self, dimension: DimensionId, selections: list[str] | None = None
    ) -> int:
        return len(self.route(dimension, selections))

    def is_mvp_ready(self, dimension: DimensionId) -> bool:
        """保留向后兼容：当前 MVP 已支持全部 5 个维度。"""
        return dimension in ("framework", "prompt", "reasoning", "context", "harness")
