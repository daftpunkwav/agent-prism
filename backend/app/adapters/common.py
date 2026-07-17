"""Adapter 共享工具。"""

from __future__ import annotations

from app.arena.token_utils import TokenTracker
from app.arena.tools import get_workspace_mgr
from app.arena.workspace import WorkspaceManager
from app.models import ArenaEvent, PipelineMetrics

__all__ = [
    "WorkspaceManager",
    "get_workspace_mgr",
    "token_update_event",
    "build_metrics",
]


def token_update_event(label: str, tracker: TokenTracker, workspace: str = "") -> ArenaEvent:
    return ArenaEvent(
        type="token_update",
        pipeline=label,
        workspace=workspace,
        token_stats=tracker.as_dict(),
    )


def build_metrics(
    tracker: TokenTracker,
    *,
    success: bool,
    duration_ms: int,
    tool_calls: int,
    steps: int,
) -> PipelineMetrics:
    stats = tracker.as_dict()
    return PipelineMetrics(
        success=success,
        duration_ms=duration_ms,
        input_tokens=int(stats["input_tokens"]),
        output_tokens=int(stats["output_tokens"]),
        total_tokens=int(stats["total_tokens"]),
        tool_calls=tool_calls,
        steps=steps,
        context_window=int(stats["context_window"]),
        max_input_tokens=int(stats["max_input_tokens"]),
        max_output_tokens=int(stats["max_output_tokens"]),
        context_usage_pct=float(stats["context_usage_pct"]),
        input_usage_pct=float(stats["input_usage_pct"]),
    )
