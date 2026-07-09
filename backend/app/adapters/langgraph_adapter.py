"""LangGraph 框架适配器 — 真实推理模式图结构 + 实时流式 token 输出。"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.harness import HarnessRunner, reflect_on_failure, verify_result
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

_GRAPH_BUILDERS = {
    "react": build_react_graph,
    "cot_tool": build_cot_tool_graph,
    "tot": build_tot_graph,
    "reflexion": build_reflexion_graph,
}


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
        # Harness Runner — 真正跑 verify/reflect/self_evolve 循环
        harness_runner = HarnessRunner(level=config.harness)
        try:
            system, user = build_messages(
                question, config.prompt_profile, config.reasoning, config.harness
            )
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker)

            mode_label = get_reasoning_description(config.reasoning) or "ReAct 循环"
            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=0,
                content=f"[LangGraph] {mode_label} · {config.prompt_profile}",
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

            # 逐事件发出；thought 实时 delta 流式输出。
            final_state: dict | None = None

            async for event in graph.astream_events(initial_state, version="v2"):
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
                        yield token_update_event(label, tracker)
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
                elif kind == "on_chain_end" and isinstance(data.get("output"), dict):
                    final_state = data["output"]

            # Harness 验证/反思（非 bare 时）
            if config.harness != "bare" and final_state:
                messages_list = final_state.get("messages", [])
                if messages_list:
                    last_msg = messages_list[-1]
                    answer = getattr(last_msg, "content", str(last_msg))
                    if isinstance(answer, list):
                        answer = " ".join(
                            b.get("thinking", b.get("text", "")) if isinstance(b, dict) else str(b)
                            for b in answer
                        )
                    answer_text = str(answer)[:2000]
                    passed, reason = verify_result(question, answer_text)
                    yield ArenaEvent(
                        type="verify",
                        pipeline=label,
                        step=step + 1,
                        content=f"[{config.harness}] 验证: {reason}",
                        passed=passed,
                    )
                    if not passed:
                        insight = reflect_on_failure(question, answer_text, reason)
                        yield ArenaEvent(
                            type="reflect",
                            pipeline=label,
                            step=step + 2,
                            content=f"[反思] {insight}",
                        )

            duration_ms = int((time.perf_counter() - started) * 1000)
            yield ArenaEvent(
                type="complete",
                pipeline=label,
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
            yield ArenaEvent(
                type="error",
                pipeline=label,
                message=str(exc),
            )
            yield ArenaEvent(
                type="complete",
                pipeline=label,
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
            clear_current_workspace()