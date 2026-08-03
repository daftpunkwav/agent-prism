"""思考强度 → Provider 请求参数映射。

Anthropic Messages：``thinking: {type: enabled, budget_tokens}``。
OpenAI Chat 兼容：``reasoning_effort``（DeepSeek / 部分代理）+ extra_body 兜底。
"""

from __future__ import annotations

from typing import Any

from app.arena.types import ApiFormat, ThinkingLevel

# 各档位思考 token 预算（须 < max_tokens，调用方负责抬高 max_tokens）
THINKING_BUDGET: dict[ThinkingLevel, int] = {
    "off": 0,
    "low": 2048,
    "medium": 8192,
    "high": 16384,
}


def thinking_budget(level: ThinkingLevel | str) -> int:
    """返回档位对应的 budget_tokens。"""
    return THINKING_BUDGET.get(level, 0)  # type: ignore[arg-type]


def build_thinking_client_kwargs(
    *,
    api_format: ApiFormat | str,
    level: ThinkingLevel | str,
    thinking_capable: bool,
    max_tokens: int,
) -> dict[str, Any]:
    """生成传入 Chat 客户端的思考相关 kwargs。

    不支持思考或 level=off 时返回空 dict。
    Anthropic：抬高 max_tokens 以保证 budget < max_tokens。
    """
    if not thinking_capable or level == "off":
        return {}

    budget = thinking_budget(level)
    if budget <= 0:
        return {}

    if api_format == "anthropic_messages":
        # budget 必须小于 max_tokens；至少留 1024 给最终回答
        need_max = budget + 1024
        out: dict[str, Any] = {
            "thinking": {"type": "enabled", "budget_tokens": budget},
        }
        if max_tokens < need_max:
            out["max_tokens"] = need_max
        return out

    # openai_chat 兼容：常见 reasoning_effort；同时塞 extra_body 供代理透传
    effort = level if level in ("low", "medium", "high") else "medium"
    return {
        "reasoning_effort": effort,
        "model_kwargs": {
            "extra_body": {
                "reasoning_effort": effort,
                "thinking": {"type": "enabled", "budget_tokens": budget},
            }
        },
    }
