"""LangChain 框架适配器 — create_agent + 真实 context/harness 中间件。"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

from app.adapters._common_run import (
    RunState,
    begin_pipeline,
    build_initial_lc_messages,
    create_run_workspace,
    emit_harness_event,
    emit_stream_event,
    finish_event,
)
from app.adapters.common import token_update_event
from app.arena.context_manager import prepare_messages_for_llm
from app.arena.errors import sanitize_error_message
from app.arena.harness import HarnessRunner
from app.arena.llm import (
    clear_pipeline_llm_overrides,
    create_chat_model,
)
from app.arena.message_sanitize import sanitize_messages_for_model, with_tool_grounding
from app.arena.tools import clear_active_toolset, get_active_tools
from app.arena.workspace import clear_current_workspace
from app.models import ArenaEvent, ChatMessage, PipelineConfig

logger = logging.getLogger(__name__)


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
        # 防御：create_agent 的 messages 侧不得再含 System（Anthropic 会报非连续 system）
        cleaned_rest: list = []
        for m in rest:
            if isinstance(m, SystemMessage):
                text = str(getattr(m, "content", "") or "").strip()
                if text:
                    cleaned_rest.append(HumanMessage(content=f"[系统补充]\n{text}"))
                continue
            cleaned_rest.append(m)
        return request.override(messages=cleaned_rest, system_message=system_message)

    def wrap_model_call(self, request, handler):
        return handler(self._prepare(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._prepare(request))

    def _decide_block(self, request) -> ToolMessage | None:
        """公共：评估工具相关性，需要拦截时返回拦截 ToolMessage，否则 None。

        同步/异步两份工具包装仅在此判断后的「执行 handler」一步不同。
        """
        from app.arena.tool_guard import blocked_tool_message_content

        call = request.tool_call or {}
        tool_name = str(call.get("name") or "")
        tool_args = call.get("args") if isinstance(call.get("args"), dict) else {}
        state_msgs: list = []
        if isinstance(request.state, dict):
            state_msgs = request.state.get("messages") or []
        prior: list[str] = []
        for m in state_msgs:
            tcs = getattr(m, "tool_calls", None) or []
            prior.extend(str(c.get("name") or "") for c in tcs)

        blocked = blocked_tool_message_content(
            self.question,
            tool_name,
            tool_args,
            prior_tool_names=prior,
        )
        if blocked is not None:
            return ToolMessage(
                content=blocked,
                tool_call_id=str(call.get("id") or ""),
            )
        return None

    def _wrap_result(self, result: object) -> object:
        """把工具执行结果包装为带任务锚定的 ToolMessage（仅当结果已是 ToolMessage）。"""
        from app.arena.message_sanitize import inject_tool_result_reminder

        if isinstance(result, ToolMessage):
            return ToolMessage(
                content=inject_tool_result_reminder(str(result.content), self.question),
                tool_call_id=result.tool_call_id,
                name=getattr(result, "name", None),
            )
        return result

    def wrap_tool_call(self, request, handler):
        blocked = self._decide_block(request)
        if blocked is not None:
            return blocked
        return self._wrap_result(handler(request))

    async def awrap_tool_call(self, request, handler):
        blocked = self._decide_block(request)
        if blocked is not None:
            return blocked
        return self._wrap_result(await handler(request))


class LangChainAdapter:
    framework_id = "langchain"
    display_name = "LangChain"

    async def run(
        self,
        question: str,
        config: PipelineConfig,
        *,
        history: list[ChatMessage] | None = None,
    ) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        state = RunState.for_pipeline(label, config)
        # workspace 创建在 try 外（失败直接抛给 runner 收敛，与原实现一致）
        state.ws_name = create_run_workspace(question, label)

        try:
            system, user = begin_pipeline(question, config, label)
            state.tracker.seed_prompt(system, user)
            yield token_update_event(label, state.tracker, workspace=state.ws_name)

            reasoning_note = (
                "推理=图结构"
                if config.reasoning == "react"
                else "推理=仅 Prompt（create_agent 骨架仍为 Tool Calling）"
            )
            hist_n = len(history or [])
            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=0,
                content=(
                    f"[LangChain create_agent] Tool Calling · {config.prompt_profile} · "
                    f"context={config.context}(真实裁剪) · harness={config.harness} · "
                    f"temp={config.temperature} · model={config.model_id} · "
                    f"max_steps={config.max_steps} · toolset={config.toolset} · {reasoning_note}"
                    + (f" · history={hist_n}" if hist_n else "")
                ),
            )

            tools = get_active_tools()
            llm = create_chat_model(
                temperature=config.temperature,
                model=config.model_id or None,
                max_tokens=config.max_output_tokens,
                top_p=config.top_p,
                frequency_penalty=config.frequency_penalty,
                presence_penalty=config.presence_penalty,
            )
            agent = create_agent(
                llm,
                tools,
                system_prompt=system,
                middleware=[_ArenaContextMiddleware(config.context, question=question)],
            ).with_config({"recursion_limit": max(25, int(config.max_steps) * 4)})
            initial_state: dict[str, Any] = {
                "messages": build_initial_lc_messages(system, user, history),
            }

            harness_runner = HarnessRunner(level=config.harness)

            async for event in harness_runner.stream_events(question, agent, initial_state):
                harness_evts = emit_harness_event(state, event)
                if harness_evts:
                    for ev in harness_evts:
                        yield ev
                    continue
                for ev in emit_stream_event(state, event):
                    yield ev

            yield finish_event(state, success=True)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Pipeline %s 失败", label)
            yield ArenaEvent(
                type="error",
                pipeline=label,
                workspace=state.ws_name,
                message=sanitize_error_message(exc),
            )
            yield finish_event(state, success=False)
        finally:
            clear_pipeline_llm_overrides()
            clear_active_toolset()
            clear_current_workspace()
