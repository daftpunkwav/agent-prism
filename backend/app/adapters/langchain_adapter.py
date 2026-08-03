"""LangChain 框架适配器 — create_agent + 真实 context/harness 中间件。"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters.common import build_metrics, get_workspace_mgr, token_update_event
from app.arena.context_manager import prepare_messages_for_llm
from app.arena.errors import sanitize_error_message
from app.arena.harness import HarnessRunner
from app.arena.llm import (
    clear_pipeline_llm_overrides,
    create_chat_model,
    set_pipeline_llm_overrides,
)
from app.arena.message_sanitize import sanitize_messages_for_model, with_tool_grounding
from app.arena.prompts import build_messages
from app.arena.stream_utils import extract_chunk_parts
from app.arena.token_utils import TokenTracker, extract_usage
from app.arena.tools import ARENA_TOOLS
from app.arena.workspace import clear_current_workspace, set_current_workspace
from app.models import ArenaEvent, PipelineConfig

logger = logging.getLogger(__name__)


def _normalize_args(input_value: object) -> dict:
    """统一将 LangChain 工具输入规范成 dict。"""
    if isinstance(input_value, dict):
        return input_value
    return {"input": input_value}


class _ArenaContextMiddleware(AgentMiddleware):
    """在每次模型调用前：上下文裁剪 + 消息消毒 + 任务强化；工具调用做跑题护栏。"""

    def __init__(self, context_strategy: str = "sliding", question: str = "") -> None:
        super().__init__()
        self.context_strategy = context_strategy
        self.question = question

    def _prepare(self, request):
        msgs = list(request.messages or [])
        if request.system_message is not None:
            combined = [request.system_message, *msgs]
        else:
            combined = msgs
        combined = prepare_messages_for_llm(combined, self.context_strategy)
        combined = sanitize_messages_for_model(combined)
        combined = with_tool_grounding(combined)
        system_message = request.system_message
        rest = combined
        if combined and isinstance(combined[0], SystemMessage):
            system_message = combined[0]
            rest = combined[1:]
        return request.override(messages=rest, system_message=system_message)

    def wrap_model_call(self, request, handler):
        return handler(self._prepare(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._prepare(request))

    def _guard_tool(self, request, handler):
        from langchain_core.messages import ToolMessage

        from app.arena.message_sanitize import inject_tool_result_reminder
        from app.arena.tool_guard import assess_tool_relevance

        call = request.tool_call or {}
        tool_name = str(call.get("name") or "")
        tool_args = call.get("args") if isinstance(call.get("args"), dict) else {}
        state_msgs = []
        if isinstance(request.state, dict):
            state_msgs = request.state.get("messages") or []
        prior = []
        for m in state_msgs:
            tcs = getattr(m, "tool_calls", None) or []
            prior.extend(str(c.get("name") or "") for c in tcs)

        allowed, reason = assess_tool_relevance(
            self.question,
            tool_name,
            tool_args,
            prior_tool_names=prior,
        )
        if not allowed:
            return ToolMessage(
                content=inject_tool_result_reminder(reason, self.question),
                tool_call_id=str(call.get("id") or ""),
            )
        result = handler(request)
        if isinstance(result, ToolMessage):
            return ToolMessage(
                content=inject_tool_result_reminder(str(result.content), self.question),
                tool_call_id=result.tool_call_id,
                name=getattr(result, "name", None),
            )
        return result

    def wrap_tool_call(self, request, handler):
        return self._guard_tool(request, handler)

    async def awrap_tool_call(self, request, handler):
        from langchain_core.messages import ToolMessage

        from app.arena.message_sanitize import inject_tool_result_reminder
        from app.arena.tool_guard import assess_tool_relevance

        call = request.tool_call or {}
        tool_name = str(call.get("name") or "")
        tool_args = call.get("args") if isinstance(call.get("args"), dict) else {}
        state_msgs = []
        if isinstance(request.state, dict):
            state_msgs = request.state.get("messages") or []
        prior = []
        for m in state_msgs:
            tcs = getattr(m, "tool_calls", None) or []
            prior.extend(str(c.get("name") or "") for c in tcs)

        allowed, reason = assess_tool_relevance(
            self.question,
            tool_name,
            tool_args,
            prior_tool_names=prior,
        )
        if not allowed:
            return ToolMessage(
                content=inject_tool_result_reminder(reason, self.question),
                tool_call_id=str(call.get("id") or ""),
            )
        result = await handler(request)
        if isinstance(result, ToolMessage):
            return ToolMessage(
                content=inject_tool_result_reminder(str(result.content), self.question),
                tool_call_id=result.tool_call_id,
                name=getattr(result, "name", None),
            )
        return result



class LangChainAdapter:
    framework_id = "langchain"
    display_name = "LangChain"

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        started = time.perf_counter()
        step = 0
        tool_calls = 0
        tracker = TokenTracker.from_provider()
        streaming_step: int | None = None
        thinking_step: int | None = None

        # 每个运行实例独占一个工作空间（时间戳 + uuid 后缀，避免同毫秒碰撞覆盖）
        ws_name = f"{label}_{int(started * 1000)}_{uuid.uuid4().hex[:6]}"
        ws = get_workspace_mgr().create(ws_name)
        set_current_workspace(ws_name)
        ws.write_file("README.md", f"# {label} Agent 工作空间\n\n问题: {question}\n")

        try:
            set_pipeline_llm_overrides(
                temperature=config.temperature,
                model=config.model_id or None,
            )
            llm = create_chat_model(
                temperature=config.temperature,
                model=config.model_id or None,
            )
            system, user = build_messages(
                question, config.prompt_profile, config.reasoning, config.harness, config.context
            )
            tracker.seed_prompt(system, user)
            yield token_update_event(label, tracker, workspace=ws_name)

            reasoning_note = (
                "推理=图结构"
                if config.reasoning == "react"
                else "推理=仅 Prompt（create_agent 骨架仍为 Tool Calling）"
            )
            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=step,
                content=(
                    f"[LangChain create_agent] Tool Calling · {config.prompt_profile} · "
                    f"context={config.context}(真实裁剪) · harness={config.harness} · {reasoning_note}"
                ),
            )

            agent = create_agent(
                llm,
                ARENA_TOOLS,
                system_prompt=system,
                middleware=[_ArenaContextMiddleware(config.context, question=question)],
            )
            initial_state: dict[str, Any] = {
                "messages": [SystemMessage(content=system), HumanMessage(content=user)],
            }

            harness_runner = HarnessRunner(level=config.harness)

            async for event in harness_runner.stream_events(question, agent, initial_state):
                if isinstance(event, dict) and event.get("_harness"):
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    thinking_step = None
                    step += 1
                    yield ArenaEvent(
                        type=event.get("type") or "verify",  # type: ignore[arg-type]
                        pipeline=label,
                        step=step,
                        content=str(event.get("content") or ""),
                        passed=event.get("passed"),
                        workspace=ws_name,
                    )
                    continue

                kind = event.get("event", "")
                data = event.get("data", {})

                if kind == "on_chat_model_stream":
                    thinking, text = extract_chunk_parts(data.get("chunk"))
                    if thinking:
                        if thinking_step is None:
                            step += 1
                            thinking_step = step
                        yield ArenaEvent(
                            type="thinking",
                            pipeline=label,
                            step=thinking_step,
                            content=thinking,
                        )
                    if text:
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
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    thinking_step = None
                elif kind == "on_tool_start":
                    if streaming_step is not None:
                        yield ArenaEvent(
                            type="thought_end",
                            pipeline=label,
                            step=streaming_step,
                            content="",
                        )
                        streaming_step = None
                    thinking_step = None
                    tool_calls += 1
                    step += 1
                    yield ArenaEvent(
                        type="action",
                        pipeline=label,
                        step=step,
                        tool=event.get("name", "tool"),
                        args=_normalize_args(data.get("input")),
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
                message=sanitize_error_message(exc),
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
