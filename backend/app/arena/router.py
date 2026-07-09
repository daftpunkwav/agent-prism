"""维度路由 — 根据对比维度生成 PipelineConfig 列表。"""

from __future__ import annotations

from functools import lru_cache

from app.config import ProviderConfig, load_provider_config
from app.models import DimensionId, PipelineConfig, PromptProfile

DEFAULT_BASE: dict = {
    "framework": "langgraph",
    "reasoning": "react",
    "context": "sliding",
    "harness": "bare",
    "prompt_profile": "zero_shot",
    "prompt_version": "v1.0.0",
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


class DimensionRouter:
    def route(self, dimension: DimensionId) -> list[PipelineConfig]:
        if dimension == "framework":
            return [
                _base(framework="langchain", label="LangChain"),
                _base(framework="langgraph", label="LangGraph"),
            ]
        if dimension == "prompt":
            profiles: list[tuple[PromptProfile, str]] = [
                ("zero_shot", "Zero-shot"),
                ("few_shot", "Few-shot"),
                ("cot_prompt", "CoT Prompt"),
                ("structured", "Structured"),
            ]
            return [_base(prompt_profile=p, label=label) for p, label in profiles]
        if dimension == "reasoning":
            return [
                _base(reasoning="react", label="ReAct"),
                _base(reasoning="cot_tool", label="CoT+Tool"),
                _base(reasoning="tot", label="ToT"),
                _base(reasoning="reflexion", label="Reflexion"),
            ]
        if dimension == "context":
            return [
                _base(context="sliding", label="滑动窗口"),
                _base(context="summary", label="摘要压缩"),
                _base(context="vector", label="向量检索"),
                _base(context="hybrid", label="混合策略"),
            ]
        if dimension == "harness":
            return [
                _base(harness="bare", label="裸运行"),
                _base(harness="verify", label="验证循环"),
                _base(harness="reflect", label="反思循环"),
                _base(harness="self_evolve", label="自进化"),
            ]
        raise ValueError(f"未知维度: {dimension}")

    def column_count(self, dimension: DimensionId) -> int:
        return len(self.route(dimension))

    def is_mvp_ready(self, dimension: DimensionId) -> bool:
        """保留向后兼容：当前 MVP 已支持全部 5 个维度。"""
        return dimension in ("framework", "prompt", "reasoning", "context", "harness")
