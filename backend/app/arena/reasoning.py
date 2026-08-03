"""推理模式引擎 — 不同的推理编排方式。

推理模式的单一来源注册表位于 :mod:`app.arena.reasoning_graph` 的
``REASONING_MODES``（prompt 后缀、图构建器、显示标签聚合一处），
本模块仅从注册表派生 prompt 应用逻辑，避免新增模式时多处散落修改。
"""

from __future__ import annotations

from app.arena.reasoning_graph import REASONING_MODES
from app.arena.types import ReasoningMode

__all__ = [
    "ReasoningMode",
    "apply_reasoning_mode",
    "get_reasoning_description",
]


def apply_reasoning_mode(
    base_system: str,
    base_user: str,
    mode: ReasoningMode,
) -> tuple[str, str]:
    """根据推理模式调整 system 和 user prompt。"""
    spec = REASONING_MODES.get(mode, REASONING_MODES["react"])
    system = base_system + spec.system_suffix
    user = base_user + spec.user_suffix
    return system, user


def get_reasoning_description(mode: ReasoningMode) -> str:
    spec = REASONING_MODES.get(mode)
    return spec.description if spec else ""
