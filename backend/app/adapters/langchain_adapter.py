"""LangChain 框架适配器 — create_agent 链式 Tool Calling。"""

from __future__ import annotations

import time
from typing import AsyncIterator

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.llm import create_chat_model
from app.arena.prompts import build_messages
from app.arena.stream_utils import extract_chunk_text
from app.arena.token_utils import TokenTracker, extract_usage
from app.arena.tools import ARENA_TOOLS, set_current_workspace
from app.arena.workspace import clear_current_workspace
from app.models import ArenaEvent, PipelineConfig


class LangChainAdapter:
    framework_id = "langchain"
    display_name = "LangChain"

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

        try:
            llm = create_chat_model()
            system, user = build_messages(question, config.prompt_profile)
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker)

            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=step,
                content=f"[LangChain create_agent] 初始化 Tool Calling · {config.prompt_profile}",
            )

            agent = create_agent(llm, ARENA_TOOLS, system_prompt=system)

            buffer = ""

            messages = [SystemMessage(content=system), HumanMessage(content=user)]

            async for event in agent.astream_events(
                {"messages": messages},
                version="v2",
            ):
                kind = event.get("event", "")
                data = event.get("data", {})

                if kind == "on_chat_model_stream":
                    chunk = data.get("chunk")
                    text = extract_chunk_text(chunk)
                    if text:
                        buffer += str(text)
                elif kind == "on_chat_model_end":
                    if buffer.strip():
                        step += 1
                        yield ArenaEvent(
                            type="thought",
                            pipeline=label,
                            step=step,
                            content=buffer.strip(),
                        )
                    buffer = ""
                    usage = extract_usage(data)
                    if usage["input_tokens"] or usage["output_tokens"]:
                        tracker.add_usage(usage)
                        yield token_update_event(label, tracker)
                elif kind == "on_tool_start":
                    tool_calls += 1
                    step += 1
                    yield ArenaEvent(
                        type="action",
                        pipeline=label,
                        step=step,
                        tool=event.get("name", "tool"),
                        args=data.get("input", {})
                        if isinstance(data.get("input"), dict)
                        else {"input": data.get("input")},
                    )
                elif kind == "on_tool_end":
                    step += 1
                    yield ArenaEvent(
                        type="observation",
                        pipeline=label,
                        step=step,
                        result=str(data.get("output", "")),
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
