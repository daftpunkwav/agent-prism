"""Token 统计与估算。"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.config import ProviderConfig, load_provider_config


def estimate_tokens(text: str) -> int:
    """粗略估算 token 数（中英文混合）。"""
    if not text:
        return 0
    return max(1, len(text) // 3)


def extract_usage(data: dict) -> dict[str, int]:
    """从 LangChain on_chat_model_end 事件提取用量。"""
    output = data.get("output")
    usage = getattr(output, "usage_metadata", None) or {}
    if not usage and output is not None:
        resp_meta = getattr(output, "response_metadata", None) or {}
        usage = resp_meta.get("usage", resp_meta.get("token_usage", {}))

    input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    return {"input_tokens": input_tokens, "output_tokens": output_tokens}


@dataclass
class TokenTracker:
    """管线级 token 累计。"""

    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_input_tokens: int = 0
    _usage_from_api: bool = field(default=False, repr=False)

    @classmethod
    def from_provider(cls, cfg: ProviderConfig | None = None) -> TokenTracker:
        provider = cfg or load_provider_config()
        return cls(
            context_window=provider.context_window,
            max_input_tokens=provider.max_input_tokens,
            max_output_tokens=provider.max_output_tokens,
        )

    def seed_prompt(self, system: str, user: str) -> None:
        self.estimated_input_tokens = estimate_tokens(system) + estimate_tokens(user)

    def add_usage(self, usage: dict[str, int]) -> None:
        """累加一次 LLM 调用的 token 用量。"""
        inp = usage.get("input_tokens", 0) or 0
        out = usage.get("output_tokens", 0) or 0
        self.input_tokens += inp
        self.output_tokens += out
        if inp or out:
            self._usage_from_api = True

    @property
    def effective_input_tokens(self) -> int:
        if self._usage_from_api:
            return self.input_tokens
        return self.estimated_input_tokens

    @property
    def total_tokens(self) -> int:
        return self.effective_input_tokens + self.output_tokens

    @property
    def context_usage_pct(self) -> float:
        if self.context_window <= 0:
            return 0.0
        return round(min(100.0, self.total_tokens / self.context_window * 100), 2)

    @property
    def input_usage_pct(self) -> float:
        if self.max_input_tokens <= 0:
            return 0.0
        return round(min(100.0, self.effective_input_tokens / self.max_input_tokens * 100), 2)

    def as_dict(self) -> dict:
        inp = self.effective_input_tokens
        return {
            "input_tokens": inp,
            "output_tokens": self.output_tokens,
            "total_tokens": inp + self.output_tokens,
            "context_window": self.context_window,
            "max_input_tokens": self.max_input_tokens,
            "max_output_tokens": self.max_output_tokens,
            "context_usage_pct": self.context_usage_pct,
            "input_usage_pct": self.input_usage_pct,
        }
