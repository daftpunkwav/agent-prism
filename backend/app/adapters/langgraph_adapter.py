"""LangGraph 框架适配器。"""

from __future__ import annotations

import time
from typing import AsyncIterator

from langgraph.prebuilt import create_react_agent

from app.arena.llm import create_chat_model
from app.arena.prompts import build_messages
from app.arena.tools import ARENA_TOOLS
from app.models import ArenaEvent, PipelineConfig, PipelineMetrics


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
        success = True
        total_tokens = 0

        try:
            llm = create_chat_model()
            agent = create_react_agent(llm, ARENA_TOOLS)
            system, user = build_messages(question, config.prompt_profile)

            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=step,
                content=f"[LangGraph StateGraph] 启动 ReAct 循环 · {config.prompt_profile}",
            )

            inputs = {
                "messages": [
                    ("system", system),
                    ("user", user),
                ]
            }

            async for event in agent.astream_events(inputs, version="v2"):
                kind = event.get("event", "")
                data = event.get("data", {})

                if kind == "on_chat_model_stream":
                    chunk = data.get("chunk")
                    text = getattr(chunk, "content", "") if chunk else ""
                    if text:
                        step += 1
                        yield ArenaEvent(
                            type="thought",
                            pipeline=label,
                            step=step,
                            content=str(text),
                        )
                elif kind == "on_tool_start":
                    tool_calls += 1
                    step += 1
                    tool_name = event.get("name", "tool")
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

            duration_ms = int((time.perf_counter() - started) * 1000)
            yield ArenaEvent(
                type="complete",
                pipeline=label,
                metrics=PipelineMetrics(
                    success=success,
                    duration_ms=duration_ms,
                    total_tokens=total_tokens,
                    tool_calls=tool_calls,
                    steps=step,
                ),
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
                metrics=PipelineMetrics(
                    success=False,
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    tool_calls=tool_calls,
                    steps=step,
                ),
            )
