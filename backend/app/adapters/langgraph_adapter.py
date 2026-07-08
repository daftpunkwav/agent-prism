"""LangGraph 框架适配器 — 真实推理模式图结构。"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.harness import HarnessRunner, reflect_on_failure, verify_result
from app.arena.prompts import build_messages
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


class LangGraphAdapter:
    framework_id = "langgraph"
    display_name = "LangGraph"

    async def run(
        self, question: str, config: PipelineConfig
    ) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        started = time.perf_counter()
        step = 0
        tool_calls = 0
        tracker = TokenTracker.from_provider()

        # 创建工作空间
        ws_name = f"{label}_{int(started * 1000)}"
        ws = get_workspace_mgr().create(ws_name)
        set_current_workspace(ws_name)
        ws.write_file("README.md", f"# {label} Agent 工作空间\n\n问题: {question}\n")

        # Harness 运行器
        harness_runner = HarnessRunner(level=config.harness)

        try:
            system, user = build_messages(question, config.prompt_profile, config.reasoning, config.harness)
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker)

            mode_label = {
                "react": "ReAct 循环",
                "cot_tool": "CoT+Tool 推理→行动",
                "tot": "Tree-of-Thought 多分支",
                "reflexion": "Reflexion 反思重试",
            }.get(config.reasoning, "ReAct 循环")

            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=0,
                content=f"[LangGraph {mode_label}] 启动 · {config.prompt_profile}",
            )

            # 根据推理模式构建图
            graph_map = {
                "react": build_react_graph,
                "cot_tool": build_cot_tool_graph,
                "tot": build_tot_graph,
                "reflexion": build_reflexion_graph,
            }
            graph_builder = graph_map.get(config.reasoning, build_react_graph)
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

            buffer = ""
            step_inner = [0]
            tc_inner = [0]
            buf_inner = [""]

            async def process_event(event):
                kind = event.get("event", "")
                data = event.get("data", {})
                node_name = event.get("name", "")

                if kind == "on_chat_model_stream":
                    chunk = data.get("chunk")
                    text = extract_chunk_text(chunk)
                    if text:
                        buf_inner[0] += str(text)
                elif kind == "on_chat_model_end":
                    if buf_inner[0].strip():
                        step_inner[0] += 1
                        yield ArenaEvent(
                            type="thought", pipeline=label,
                            step=step_inner[0], content=buf_inner[0].strip(),
                        )
                    buf_inner[0] = ""
                    usage = extract_usage(data)
                    if usage["input_tokens"] or usage["output_tokens"]:
                        tracker.add_usage(usage)
                        yield token_update_event(label, tracker)
                elif kind == "on_tool_start":
                    tc_inner[0] += 1
                    step_inner[0] += 1
                    tool_name = data.get("name", node_name)
                    tool_input = data.get("input", {})
                    yield ArenaEvent(
                        type="action", pipeline=label,
                        step=step_inner[0], tool=tool_name,
                        args=tool_input if isinstance(tool_input, dict) else {"input": tool_input},
                    )
                elif kind == "on_tool_end":
                    step_inner[0] += 1
                    output = data.get("output", "")
                    yield ArenaEvent(
                        type="observation", pipeline=label,
                        step=step_inner[0], result=str(output),
                    )
                elif kind == "on_node_start" and node_name not in ("agent", "execute"):
                    yield ArenaEvent(
                        type="thought", pipeline=label,
                        step=step_inner[0], content=f"[阶段: {node_name}]",
                    )

            async for event in graph.astream_events(initial_state, version="v2"):
                async for ev in process_event(event):
                    yield ev
                step = step_inner[0]
                tool_calls = tc_inner[0]
                buffer = buf_inner[0]

            # Harness: 非裸运行时执行验证/反思
            if config.harness != "bare" and step_inner[0] > 0:
                messages_list = initial_state.get("messages", [])
                if messages_list:
                    last_msg = messages_list[-1]
                    answer = getattr(last_msg, "content", str(last_msg))
                    passed, reason = verify_result(question, answer[:2000])
                    yield ArenaEvent(
                        type="verify", pipeline=label,
                        step=step_inner[0] + 1,
                        content=f"[{config.harness}] 验证: {reason}",
                        passed=passed,
                    )
                    if not passed:
                        insight = reflect_on_failure(question, answer[:2000], reason)
                        yield ArenaEvent(
                            type="reflect", pipeline=label,
                            step=step_inner[0] + 2,
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
