"""LangGraph 框架适配器 — 真实推理模式图结构 + 实时流式 token 输出。"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.harness import HarnessRunner
from app.arena.llm import clear_pipeline_llm_overrides, set_pipeline_llm_overrides
from app.arena.prompts import build_messages
from app.arena.reasoning import get_reasoning_description
from app.arena.reasoning_graph import (
    build_cot_tool_graph,
    build_react_graph,
    build_reflexion_graph,
    build_tot_graph,
)
from app.arena.stream_utils import extract_chunk_text
from app.arena.token_utils import TokenTracker, extract_usage
from app.arena.workspace import clear_current_workspace, set_current_workspace
from app.models import ArenaEvent, PipelineConfig

logger = logging.getLogger(__name__)

_GRAPH_BUILDERS = {
    "react": build_react_graph,
    "cot_tool": build_cot_tool_graph,
    "tot": build_tot_graph,
    "reflexion": build_reflexion_graph,
}


def _sanitize_error(exc: Exception) -> str:
    """脱敏异常消息，仅保留类型名。"""
    return f"{type(exc).__name__}"


class LangGraphAdapter:
    framework_id = "langgraph"
    display_name = "LangGraph"

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        started = time.perf_counter()
        tracker = TokenTracker.from_provider()

        # 每个运行实例独占一个工作空间
        ws_name = f"{label}_{int(started * 1000)}"
        ws = get_workspace_mgr().create(ws_name)
        set_current_workspace(ws_name)
        ws.write_file("README.md", f"# {label} Agent 工作空间\n\n问题: {question}\n")

        step = 0
        tool_calls = 0
        # 在后端也保留当前正在流式输出的 step，便于 tool_start 正确递增
        streaming_step: int | None = None
        try:
            set_pipeline_llm_overrides(
                temperature=config.temperature,
                model=config.model_id or None,
            )
            system, user = build_messages(
                question, config.prompt_profile, config.reasoning, config.harness, config.context
            )
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker, workspace=ws_name)

            mode_label = get_reasoning_description(config.reasoning) or "ReAct 循环"
            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=0,
                content=(
                    f"[LangGraph] {mode_label} · {config.prompt_profile} · "
                    f"context={config.context} · harness={config.harness}"
                ),
            )

            graph_builder = _GRAPH_BUILDERS.get(config.reasoning, build_react_graph)
            # 提高 LangGraph 默认递归限制（默认 25）；同时 max_steps 控制业务循环
            graph = graph_builder().compile().with_config({"recursion_limit": 50})

            initial_state = {
                "messages": [
                    SystemMessage(content=system),
                    HumanMessage(content=user),
                ],
                "step_count": 0,
                "max_steps": 10,
                "tool_calls": 0,
                "reflections": [],
            }

            # 通过 HarnessRunner 接入验证/反思/自进化循环（bare 仅单次流式）
            harness_runner = HarnessRunner(level=config.harness)

            async for event in harness_runner.stream_events(question, graph, initial_state):
                # Harness 控制事件（verify / reflect / harness_edit）
                if isinstance(event, dict) and event.get("_harness"):
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    step += 1
                    ev_type = event.get("type") or "verify"
                    yield ArenaEvent(
                        type=ev_type,  # type: ignore[arg-type]
                        pipeline=label,
                        step=step,
                        content=str(event.get("content") or ""),
                        passed=event.get("passed"),
                        workspace=ws_name,
                    )
                    continue

                kind = event.get("event", "")
                data = event.get("data", {})
                node_name = event.get("name", "")

                if kind == "on_chat_model_stream":
                    text = extract_chunk_text(data.get("chunk"))
                    if text:
                        # 实时流式输出：首个 token 决定 step，后续 delta 同 step 累积
                        if streaming_step is None:
                            step += 1
                            streaming_step = step
                        yield ArenaEvent(
                            type="thought_delta",
                            pipeline=label,
                            step=streaming_step,
                            content=text,
                        )
                elif kind == "on_chat_model_end":
                    usage = extract_usage(data)
                    if usage["input_tokens"] or usage["output_tokens"]:
                        tracker.add_usage(usage)
                        yield token_update_event(label, tracker, workspace=ws_name)
                    # 标记流结束，TraceView 会切到完整 Markdown 渲染
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                    streaming_step = None
                elif kind == "on_tool_start":
                    # 若在流式输出中插入了 tool_start，应先关流式段避免 UI 重叠
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    tool_calls += 1
                    step += 1
                    tool_name = data.get("name", node_name)
                    tool_input = data.get("input", {})
                    yield ArenaEvent(
                        type="action",
                        pipeline=label,
                        step=step,
                        tool=tool_name,
                        args=tool_input if isinstance(tool_input, dict) else {"input": tool_input},
                    )
                elif kind == "on_tool_end":
                    step += 1
                    output = data.get("output", "")
                    yield ArenaEvent(
                        type="observation",
                        pipeline=label,
                        step=step,
                        result=str(output),
                    )
                elif kind == "on_node_start" and node_name not in ("agent", "execute"):
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    yield ArenaEvent(
                        type="thought",
                        pipeline=label,
                        step=step,
                        content=f"[阶段: {node_name}]",
                    )

            duration_ms = int((time.perf_counter() - started) * 1000)
            yield ArenaEvent(
                type="complete",
                pipeline=label,
                workspace=ws_name,
                metrics=build_metrics(
                    tracker,
                    success=True,
                    duration_ms=duration_ms,
                    tool_calls=tool_calls,
                    steps=step,
                ),
                token_stats=tracker.as_dict(),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Pipeline %s 失败", label)
            yield ArenaEvent(
                type="error",
                pipeline=label,
                workspace=ws_name,
                message=_sanitize_error(exc),
            )
            yield ArenaEvent(
                type="complete",
                pipeline=label,
                workspace=ws_name,
                metrics=build_metrics(
                    tracker,
                    success=False,
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    tool_calls=tool_calls,
                    steps=step,
                ),
                token_stats=tracker.as_dict(),
            )
        finally:
            clear_pipeline_llm_overrides()
            clear_current_workspace()
