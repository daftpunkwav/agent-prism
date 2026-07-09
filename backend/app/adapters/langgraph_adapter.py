"""LangGraph 框架适配器 — 真实推理模式图结构。"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.harness import reflect_on_failure, verify_result
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

    async def run(
        self, question: str, config: PipelineConfig
    ) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        started = time.perf_counter()
        tracker = TokenTracker.from_provider()

        # 创建工作空间
        ws_name = f"{label}_{int(started * 1000)}"
        ws = get_workspace_mgr().create(ws_name)
        set_current_workspace(ws_name)
        ws.write_file("README.md", f"# {label} Agent 工作空间\n\n问题: {question}\n")

        step = 0
        tool_calls = 0
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
            graph = graph_builder().compile()

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

            # 逐事件发出并维护计数器;
            # final_state 用于获取 LLM 真实最后输出以做 Harness 验证。
            buffer = ""
            final_state: dict | None = None

            async for event in graph.astream_events(initial_state, version="v2"):
                kind = event.get("event", "")
                data = event.get("data", {})
                node_name = event.get("name", "")

                if kind == "on_chat_model_stream":
                    text = extract_chunk_text(data.get("chunk"))
                    if text:
                        buffer += str(text)
                elif kind == "on_chat_model_end":
                    if buffer.strip():
                        step += 1
                        yield ArenaEvent(
                            type="thought", pipeline=label,
                            step=step, content=buffer.strip(),
                        )
                    buffer = ""
                    usage = extract_usage(data)
                    if usage["input_tokens"] or usage["output_tokens"]:
                        tracker.add_usage(usage)
                        yield token_update_event(label, tracker)
                elif kind == "on_tool_start":
                    tool_calls += 1
                    step += 1
                    tool_name = data.get("name", node_name)
                    tool_input = data.get("input", {})
                    yield ArenaEvent(
                        type="action", pipeline=label,
                        step=step, tool=tool_name,
                        args=tool_input if isinstance(tool_input, dict) else {"input": tool_input},
                    )
                elif kind == "on_tool_end":
                    step += 1
                    output = data.get("output", "")
                    yield ArenaEvent(
                        type="observation", pipeline=label,
                        step=step, result=str(output),
                    )
                elif kind == "on_node_start" and node_name not in ("agent", "execute"):
                    yield ArenaEvent(
                        type="thought", pipeline=label,
                        step=step, content=f"[阶段: {node_name}]",
                    )
                elif kind == "on_chain_end" and isinstance(data.get("output"), dict):
                    # LangGraph 节点结束后返回的 state 增量,记下最后一次即最终 state。
                    final_state = data["output"]

            # Harness 验证/反思（非 bare 时）
            if config.harness != "bare" and final_state:
                messages_list = final_state.get("messages", [])
                if messages_list:
                    last_msg = messages_list[-1]
                    answer = getattr(last_msg, "content", str(last_msg))
                    if isinstance(answer, list):
                        # 处理 extended thinking 的 content blocks
                        answer = " ".join(
                            b.get("thinking", b.get("text", "")) if isinstance(b, dict) else str(b)
                            for b in answer
                        )
                    answer_text = str(answer)[:2000]
                    passed, reason = verify_result(question, answer_text)
                    yield ArenaEvent(
                        type="verify", pipeline=label,
                        step=step + 1,
                        content=f"[{config.harness}] 验证: {reason}",
                        passed=passed,
                    )
                    if not passed:
                        insight = reflect_on_failure(question, answer_text, reason)
                        yield ArenaEvent(
                            type="reflect", pipeline=label,
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
