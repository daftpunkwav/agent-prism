"""框架适配器 run() 公共流程 — 两个 adapter 共享的事件分发与收尾。

Q3 重构：LangChain / LangGraph 两个 adapter 的 run() 在 workspace 管理、
overrides 设置、事件分发（harness / stream / tool）、complete/error 收尾
上高度重复。本模块把这些公共逻辑抽为纯函数（输入 raw 事件 dict + 状态，
输出 ArenaEvent 列表），两 adapter 仅保留「构建可运行对象」与开场事件差异。
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from app.adapters.common import build_metrics, token_update_event
from app.arena.llm import set_pipeline_llm_overrides
from app.arena.prompts import build_messages
from app.arena.stream_utils import extract_chunk_parts
from app.arena.token_utils import TokenTracker, extract_usage
from app.arena.tools import set_active_toolset
from app.arena.workspace import get_workspace_mgr, set_current_workspace
from app.models import ArenaEvent, PipelineConfig

logger = logging.getLogger(__name__)


@dataclass
class RunState:
    """单次 Pipeline 运行的状态（两个 adapter 共用）。"""

    label: str
    started: float = field(default_factory=time.perf_counter)
    step: int = 0
    tool_calls: int = 0
    tracker: TokenTracker = field(default_factory=TokenTracker.from_provider)
    streaming_step: int | None = None
    thinking_step: int | None = None
    ws_name: str = ""

    @classmethod
    def for_pipeline(cls, label: str, config: PipelineConfig) -> RunState:
        """按接入点窗口元数据 + 统一基线 max_output 构造 tracker。"""
        from app.arena.router import _lookup_endpoint
        from app.config import load_provider_config

        provider = load_provider_config()
        ep = _lookup_endpoint(config.endpoint_id or None, provider)
        tracker = TokenTracker(
            context_window=ep.context_window,
            max_input_tokens=ep.max_input_tokens,
            max_output_tokens=config.max_output_tokens,
        )
        return cls(label=label, tracker=tracker)


def create_run_workspace(question: str, label: str) -> str:
    """每个运行实例独占一个工作空间（时间戳 + uuid 后缀，避免同毫秒碰撞覆盖）。

    失败时向上抛异常（与原实现一致：workspace 创建在 try 外）。
    """
    started = time.perf_counter()
    ws_name = f"{label}_{int(started * 1000)}_{uuid.uuid4().hex[:6]}"
    ws = get_workspace_mgr().create(ws_name)
    set_current_workspace(ws_name)
    ws.write_file("README.md", f"# {label} Agent 工作空间\n\n问题: {question}\n")
    return ws_name


def begin_pipeline(question: str, config: PipelineConfig, label: str) -> tuple[str, str]:
    """设置 LLM overrides / 工具集，并构建 system/user prompt。返回 (system, user)。"""
    from app.arena.router import _lookup_endpoint
    from app.config import load_provider_config

    provider = load_provider_config()
    ep = _lookup_endpoint(config.endpoint_id or None, provider)
    set_pipeline_llm_overrides(
        endpoint_id=ep.id,
        api_key=ep.api_key,
        base_url=ep.base_url,
        api_format=ep.api_format,
        auth_field=ep.auth_field,
        temperature=config.temperature,
        model=config.model_id or ep.model,
        max_tokens=config.max_output_tokens,
        top_p=config.top_p,
        frequency_penalty=config.frequency_penalty,
        presence_penalty=config.presence_penalty,
        thinking_capable=config.thinking_capable,
        thinking_level=config.thinking_level,
    )
    set_active_toolset(config.toolset)
    return build_messages(
        question, config.prompt_profile, config.reasoning, config.harness, config.context
    )


def _normalize_args(input_value: object) -> dict:
    """统一将工具输入规范成 dict。"""
    if isinstance(input_value, dict):
        return input_value
    return {"input": input_value}


def emit_harness_event(state: RunState, event: dict) -> list[ArenaEvent]:
    """把 ``_harness`` 控制事件（verify/reflect/harness_edit）翻译为 ArenaEvent 列表。

    非 harness 事件返回空列表。包含流式 step 收尾（thought_end）。
    """
    if not (isinstance(event, dict) and event.get("_harness")):
        return []
    events: list[ArenaEvent] = []
    if state.streaming_step is not None:
        events.append(
            ArenaEvent(
                type="thought_end",
                pipeline=state.label,
                step=state.streaming_step,
                content="",
            )
        )
        state.streaming_step = None
    state.thinking_step = None
    state.step += 1
    events.append(
        ArenaEvent(
            type=event.get("type") or "verify",
            pipeline=state.label,
            step=state.step,
            content=str(event.get("content") or ""),
            passed=event.get("passed"),
            workspace=state.ws_name,
        )
    )
    return events


def emit_stream_event(
    state: RunState,
    event: dict,
    *,
    node_name: str = "",
    node_start_excluded: frozenset[str] = frozenset(),
) -> list[ArenaEvent]:
    """把 LangChain/LangGraph 的 ``astream_events`` 原始事件翻译为 ArenaEvent 列表。

    - ``node_name``：当前事件所属图节点（LangGraph 用；用于 on_node_start 阶段提示）
    - ``node_start_excluded``：不产生阶段提示的节点集合（如 agent/execute 骨架节点）
    """
    events: list[ArenaEvent] = []
    kind = event.get("event", "")
    data = event.get("data", {})
    label = state.label

    if kind == "on_chat_model_stream":
        thinking, text = extract_chunk_parts(data.get("chunk"))
        if thinking:
            if state.thinking_step is None:
                state.step += 1
                state.thinking_step = state.step
            events.append(
                ArenaEvent(
                    type="thinking",
                    pipeline=label,
                    step=state.thinking_step,
                    content=thinking,
                )
            )
        if text:
            if state.streaming_step is None:
                state.step += 1
                state.streaming_step = state.step
            events.append(
                ArenaEvent(
                    type="thought_delta",
                    pipeline=label,
                    step=state.streaming_step,
                    content=text,
                )
            )
    elif kind == "on_chat_model_end":
        usage = extract_usage(data)
        if usage["input_tokens"] or usage["output_tokens"]:
            state.tracker.add_usage(usage)
            events.append(token_update_event(label, state.tracker, workspace=state.ws_name))
        if state.streaming_step is not None:
            events.append(
                ArenaEvent(
                    type="thought_end",
                    pipeline=label,
                    step=state.streaming_step,
                    content="",
                )
            )
            state.streaming_step = None
        state.thinking_step = None
    elif kind == "on_tool_start":
        if state.streaming_step is not None:
            events.append(
                ArenaEvent(
                    type="thought_end",
                    pipeline=label,
                    step=state.streaming_step,
                    content="",
                )
            )
            state.streaming_step = None
        state.thinking_step = None
        state.tool_calls += 1
        state.step += 1
        tool_name = data.get("name") or event.get("name") or node_name or "tool"
        events.append(
            ArenaEvent(
                type="action",
                pipeline=label,
                step=state.step,
                tool=tool_name,
                args=_normalize_args(data.get("input")),
            )
        )
    elif kind == "on_tool_end":
        state.step += 1
        events.append(
            ArenaEvent(
                type="observation",
                pipeline=label,
                step=state.step,
                result=str(data.get("output", "")),
            )
        )
    elif kind == "on_node_start" and node_name and node_name not in node_start_excluded:
        if state.streaming_step is not None:
            events.append(
                ArenaEvent(
                    type="thought_end",
                    pipeline=label,
                    step=state.streaming_step,
                    content="",
                )
            )
            state.streaming_step = None
        state.thinking_step = None
        events.append(
            ArenaEvent(
                type="thought",
                pipeline=label,
                step=state.step,
                content=f"[阶段: {node_name}]",
            )
        )
    return events


def finish_event(state: RunState, success: bool) -> ArenaEvent:
    """构造 complete 事件（成功/失败共用）。"""
    return ArenaEvent(
        type="complete",
        pipeline=state.label,
        workspace=state.ws_name,
        metrics=build_metrics(
            state.tracker,
            success=success,
            duration_ms=int((time.perf_counter() - state.started) * 1000),
            tool_calls=state.tool_calls,
            steps=state.step,
        ),
        token_stats=state.tracker.as_dict(),
    )
