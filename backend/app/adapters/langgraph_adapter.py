"""LangGraph 框架适配器。"""

from __future__ import annotations

import time
from typing import AsyncIterator

from langgraph.prebuilt import create_react_agent

from app.adapters.common import build_metrics, token_update_event
from app.arena.llm import create_chat_model
from app.arena.prompts import build_messages
from app.arena.stream_utils import extract_chunk_text
from app.arena.token_utils import TokenTracker, extract_usage
from app.arena.tools import ARENA_TOOLS
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

        try:
            llm = create_chat_model()
            agent = create_react_agent(llm, ARENA_TOOLS)
            system, user = build_messages(question, config.prompt_profile)
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker)

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
                    text = extract_chunk_text(chunk)
                    if text:
                        step += 1
                        yield ArenaEvent(
                            type="thought",
                            pipeline=label,
                            step=step,
                            content=str(text),
                        )
                elif kind == "on_chat_model_end":
                    usage = extract_usage(data)
                    if usage["input_tokens"] or usage["output_tokens"]:
                        tracker.add_usage(usage)
                        yield token_update_event(label, tracker)
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
