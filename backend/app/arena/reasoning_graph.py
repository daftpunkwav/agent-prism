"""推理模式图构建器 — 为不同推理模式创建不同的 LangGraph 图结构。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from app.arena.agent_state import AgentState
from app.arena.context_manager import prepare_messages_for_llm
from app.arena.llm import create_chat_model
from app.arena.message_sanitize import sanitize_messages_for_model, with_tool_grounding
from app.arena.tools import ARENA_TOOLS
from app.arena.types import ReasoningMode


def _create_llm():
    return create_chat_model()


def _bind_tools(llm):
    return llm.bind_tools(ARENA_TOOLS)


def _llm_messages(state: AgentState, extra: list | None = None) -> list:
    """按上下文策略裁剪 → 消毒 thinking → 工具后锚定；extra 仅本次调用。"""
    strategy = state.get("context_strategy") or "sliding"
    base = prepare_messages_for_llm(state.get("messages") or [], strategy)
    base = sanitize_messages_for_model(base)
    base = with_tool_grounding(base)
    if extra:
        return list(base) + list(extra)
    return list(base)


# ===== ReAct 模式 =====


async def _react_node(state: AgentState) -> dict:
    """ReAct: 标准 Thought → Action → Observation 循环"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = await llm_with_tools.ainvoke(_llm_messages(state))
    return {"messages": [response], "step_count": state["step_count"] + 1}


async def _react_tool_node(state: AgentState) -> dict:
    """执行工具调用。未知工具也写入 ToolMessage，保证与 tool_calls 1:1 对齐。"""

    last_msg = state["messages"][-1]
    tool_calls = last_msg.tool_calls if hasattr(last_msg, "tool_calls") else []

    from langchain_core.messages import ToolMessage

    from app.arena.message_sanitize import extract_original_question, inject_tool_result_reminder
    from app.arena.tool_guard import blocked_tool_message_content

    question = extract_original_question(state.get("messages") or [])
    # 本轮之前已成功执行的工具名（粗算：用计数无法还原名字，从历史 Tool 前的 AI 收集）
    prior_names: list[str] = []
    msgs = state.get("messages") or []
    for m in msgs:
        if hasattr(m, "tool_calls") and m.tool_calls and m is not last_msg:
            prior_names.extend(str(c.get("name") or "") for c in m.tool_calls)

    tool_messages = []
    tc_count = state.get("tool_calls", 0)
    for call in tool_calls:
        tool_name = call["name"]
        tool_args = call["args"] if isinstance(call.get("args"), dict) else {}
        blocked = blocked_tool_message_content(
            question,
            tool_name,
            tool_args,
            prior_tool_names=prior_names,
        )
        if blocked is not None:
            tool_messages.append(
                ToolMessage(
                    content=blocked,
                    tool_call_id=call["id"],
                )
            )
            continue

        tool_func = next((t for t in ARENA_TOOLS if t.name == tool_name), None)
        if tool_func:
            result = await tool_func.ainvoke(tool_args)
            tc_count += 1
            prior_names.append(tool_name)
            tool_messages.append(
                ToolMessage(
                    content=inject_tool_result_reminder(str(result), question),
                    tool_call_id=call["id"],
                )
            )
        else:
            tool_messages.append(
                ToolMessage(
                    content=inject_tool_result_reminder(
                        f"错误: 未知工具 «{tool_name}»",
                        question,
                    ),
                    tool_call_id=call["id"],
                )
            )

    return {
        "messages": tool_messages,
        "tool_calls": tc_count,
    }


def _react_should_continue(state: AgentState) -> str:
    """判断是否继续循环"""
    messages = state.get("messages", [])
    if not messages:
        return END
    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    if state["step_count"] >= state["max_steps"]:
        return END
    return END


def build_react_graph() -> StateGraph:
    """构建 ReAct 图：agent ↔ tools 循环"""
    graph = StateGraph(AgentState)
    graph.add_node("agent", _react_node)
    graph.add_node("tools", _react_tool_node)
    graph.add_edge("tools", "agent")
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", _react_should_continue, {"tools": "tools", END: END})
    return graph


# ===== CoT+Tool 模式 =====


async def _cot_think_node(state: AgentState) -> dict:
    """CoT+Tool: 先完整推理，再统一调用工具"""
    llm = _create_llm()
    response = await llm.ainvoke(
        _llm_messages(
            state,
            [SystemMessage(content="\n\n[阶段1: 推理]\n请先完整分析问题，列出所有需要的步骤和工具。不要调用工具，只输出推理过程。")],
        )
    )
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


async def _cot_act_node(state: AgentState) -> dict:
    """CoT+Tool: 根据推理结果统一执行工具"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = await llm_with_tools.ainvoke(
        _llm_messages(
            state,
            [SystemMessage(content="\n\n[阶段2: 行动]\n基于上述推理，现在执行所需的工具调用。")],
        )
    )
    return {"messages": [response], "step_count": state["step_count"] + 1}


async def _cot_tool_node(state: AgentState) -> dict:
    """执行工具调用（与 ReAct 相同）"""
    return await _react_tool_node(state)


def _cot_should_continue(state: AgentState) -> str:
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return END


def build_cot_tool_graph() -> StateGraph:
    """构建 CoT+Tool 图：think → act → tools → (循环)"""
    graph = StateGraph(AgentState)
    graph.add_node("think", _cot_think_node)
    graph.add_node("act", _cot_act_node)
    graph.add_node("tools", _cot_tool_node)
    graph.add_edge("think", "act")
    graph.add_conditional_edges("act", _cot_should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "think")
    graph.set_entry_point("think")
    return graph


# ===== ToT 模式 =====


async def _tot_generate_node(state: AgentState) -> dict:
    """ToT: 生成多个候选方案"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = await llm_with_tools.ainvoke(
        _llm_messages(
            state,
            [SystemMessage(content="\n\n[ToT: 生成候选]\n请生成 2-3 个不同的解决方案思路，分别评估每个方案的优劣。")],
        )
    )
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


async def _tot_evaluate_node(state: AgentState) -> dict:
    """ToT: 评估并选择最优方案"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = await llm_with_tools.ainvoke(
        _llm_messages(
            state,
            [SystemMessage(content="\n\n[ToT: 评估选择]\n评估以上方案，选择最优的一个，然后执行。")],
        )
    )
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


async def _tot_execute_node(state: AgentState) -> dict:
    """ToT: 执行选定方案的工具调用"""
    return await _react_tool_node(state)


def _tot_should_continue(state: AgentState) -> str:
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "execute"
    return END


def build_tot_graph() -> StateGraph:
    """构建 ToT 图：generate → evaluate → execute → (循环)。

    execute 即工具执行节点；有 tool_calls 时走 execute，否则结束。
    """
    graph = StateGraph(AgentState)
    graph.add_node("generate", _tot_generate_node)
    graph.add_node("evaluate", _tot_evaluate_node)
    graph.add_node("execute", _tot_execute_node)
    graph.add_edge("generate", "evaluate")
    graph.add_conditional_edges(
        "evaluate",
        _tot_should_continue,
        {"execute": "execute", END: END},
    )
    graph.add_edge("execute", "generate")
    graph.set_entry_point("generate")
    return graph


# ===== Reflexion 模式 =====


async def _reflexion_execute_node(state: AgentState) -> dict:
    """Reflexion: 执行任务（可发起工具调用）"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = await llm_with_tools.ainvoke(_llm_messages(state))
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


async def _reflexion_reflect_node(state: AgentState) -> dict:
    """Reflexion: 反思结果质量"""
    llm = _create_llm()
    last_response = state["messages"][-1].content
    # 反思调用使用独立短上下文，避免把阶段提示写入主对话；结果再追加到 messages
    reflect_prompt = [
        SystemMessage(
            content=(
                "\n\n[Reflexion: 反思]\n评估以上回答的质量：\n"
                "1. 是否准确回答了问题？\n2. 是否有遗漏？\n3. 如何改进？\n\n输出反思结论。"
            )
        ),
        HumanMessage(content=f"回答内容：\n{last_response}"),
    ]
    response = await llm.ainvoke(reflect_prompt)
    return {
        "messages": [response],
        "reflections": state.get("reflections", []) + [response.content],
    }


def _reflexion_after_execute(state: AgentState) -> str:
    """execute 后：有 tool_calls 则先跑工具，否则进入反思。"""
    messages = state.get("messages") or []
    if not messages:
        return "reflect"
    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        if state.get("step_count", 0) >= state.get("max_steps", 10):
            return "reflect"
        return "tools"
    return "reflect"


def _reflexion_should_continue(state: AgentState) -> str:
    """判断是否需要重试"""
    if state["step_count"] >= state["max_steps"]:
        return END
    last_reflection = state.get("reflections", [])[-1] if state.get("reflections") else ""
    if "改进" in last_reflection or "不足" in last_reflection or "重新" in last_reflection:
        return "execute"
    return END


def build_reflexion_graph() -> StateGraph:
    """构建 Reflexion 图：execute ↔ tools → reflect → (条件) execute | END。"""
    graph = StateGraph(AgentState)
    graph.add_node("execute", _reflexion_execute_node)
    graph.add_node("tools", _react_tool_node)
    graph.add_node("reflect", _reflexion_reflect_node)
    graph.set_entry_point("execute")
    graph.add_conditional_edges(
        "execute",
        _reflexion_after_execute,
        {"tools": "tools", "reflect": "reflect"},
    )
    graph.add_edge("tools", "execute")
    graph.add_conditional_edges(
        "reflect",
        _reflexion_should_continue,
        {"execute": "execute", END: END},
    )
    return graph


# ===== 推理模式注册表 =====


@dataclass(frozen=True)
class ReasoningModeSpec:
    """推理模式单一来源注册项：prompt 配置 + 图构建器 + 展示信息。

    新增推理模式只需在 ``REASONING_MODES`` 中补一项，图构建、
    prompt 后缀、路由选项与前端标签自动跟随，不再需要同步改多处散落字典。
    """

    mode: ReasoningMode
    label: str
    description: str
    system_suffix: str
    user_suffix: str = ""
    graph_builder: Callable[[], StateGraph] | None = None


REASONING_MODES: dict[ReasoningMode, ReasoningModeSpec] = {
    "react": ReasoningModeSpec(
        mode="react",
        label="ReAct",
        description="标准 ReAct：Thought → Action → Observation 循环",
        system_suffix="\n\n使用 ReAct 模式：先思考（Thought），再决定行动（Action），最后观察结果（Observation），循环直到完成任务。",
        graph_builder=build_react_graph,
    ),
    "cot_tool": ReasoningModeSpec(
        mode="cot_tool",
        label="CoT+Tool",
        description="CoT+Tool：先完整推理链，再统一调用工具",
        system_suffix="\n\n使用 Chain-of-Thought + Tool 模式：先用完整推理链分析问题，规划好所有需要的步骤，然后统一执行工具调用。",
        user_suffix="\n\n请先详细分析问题，列出推理步骤，再执行工具。",
        graph_builder=build_cot_tool_graph,
    ),
    "tot": ReasoningModeSpec(
        mode="tot",
        label="ToT",
        description="ToT：多分支探索，评估后选最优",
        system_suffix="\n\n使用 Tree-of-Thought 模式：对每个步骤生成多个候选方案，评估每个方案，选择最优方案继续。",
        graph_builder=build_tot_graph,
    ),
    "reflexion": ReasoningModeSpec(
        mode="reflexion",
        label="Reflexion",
        description="Reflexion：执行 → 评估 → 反思 → 重试",
        system_suffix="\n\n使用 Reflexion 模式：执行后评估结果质量，反思改进方向，必要时重试。最多重试 2 次。",
        graph_builder=build_reflexion_graph,
    ),
}


def build_reasoning_graph(mode: ReasoningMode) -> StateGraph:
    """根据推理模式构建对应的 LangGraph 图"""
    spec = REASONING_MODES.get(mode, REASONING_MODES["react"])
    builder = spec.graph_builder or build_react_graph
    return builder()


def get_reasoning_graph(mode: ReasoningMode):
    """编译并返回可运行的图"""
    graph = build_reasoning_graph(mode)
    return graph.compile()
