"""LangGraph 框架适配器 — 真实推理模式图结构 + 实时流式 token 输出。"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from app.adapters._common_run import (
    RunState,
    begin_pipeline,
    create_run_workspace,
    emit_harness_event,
    emit_stream_event,
    finish_event,
)
from app.adapters.common import token_update_event
from app.arena.errors import sanitize_error_message
from app.arena.harness import HarnessRunner
from app.arena.llm import clear_pipeline_llm_overrides
from app.arena.reasoning import get_reasoning_description
from app.arena.reasoning_graph import REASONING_MODES, build_react_graph
from app.arena.workspace import clear_current_workspace
from app.models import ArenaEvent, PipelineConfig

logger = logging.getLogger(__name__)

# on_node_start 不产生阶段提示的骨架节点（agent/execute 是主循环节点）
_NODE_START_EXCLUDED = frozenset({"agent", "execute"})


class LangGraphAdapter:
    framework_id = "langgraph"
    display_name = "LangGraph"

    async def run(self, question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]:
        label = config.label or self.display_name
        state = RunState(label=label)
        # workspace 创建在 try 外（失败直接抛给 runner 收敛，与原实现一致）
        state.ws_name = create_run_workspace(question, label)

        try:
            system, user = begin_pipeline(question, config, label)
            state.tracker.seed_prompt(system, user)
            yield token_update_event(label, state.tracker, workspace=state.ws_name)

            mode_label = get_reasoning_description(config.reasoning) or "ReAct 循环"
            yield ArenaEvent(
                type="thought",
                pipeline=label,
                step=0,
                content=(
                    f"[LangGraph] {mode_label} · {config.prompt_profile} · "
                    f"context={config.context}(真实裁剪) · harness={config.harness}"
                ),
            )

            spec = REASONING_MODES.get(config.reasoning, REASONING_MODES["react"])
            # 提高 LangGraph 默认递归限制（默认 25）；同时 max_steps 控制业务循环
            builder = spec.graph_builder or build_react_graph
            graph = builder().compile().with_config({"recursion_limit": 50})

            initial_state = {
                "messages": [
                    SystemMessage(content=system),
                    HumanMessage(content=user),
                ],
                "step_count": 0,
                "max_steps": 10,
                "tool_calls": 0,
                "reflections": [],
                "context_strategy": config.context,
            }

            # 通过 HarnessRunner 接入验证/反思/自进化循环（bare 仅单次流式）
            harness_runner = HarnessRunner(level=config.harness)

            async for event in harness_runner.stream_events(question, graph, initial_state):
                harness_evts = emit_harness_event(state, event)
                if harness_evts:
                    for ev in harness_evts:
                        yield ev
                    continue
                node_name = event.get("name", "") if isinstance(event, dict) else ""
                for ev in emit_stream_event(
                    state,
                    event,
                    node_name=node_name,
                    node_start_excluded=_NODE_START_EXCLUDED,
                ):
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
            clear_current_workspace()
