"""推理模式图构建器 — 为不同推理模式创建不同的 LangGraph 图结构。"""

from __future__ import annotations

from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from app.arena.agent_state import AgentState
from app.arena.llm import create_chat_model
from app.arena.tools import ARENA_TOOLS

ReasoningMode = Literal["react", "cot_tool", "tot", "reflexion"]


def _create_llm():
    return create_chat_model()


def _bind_tools(llm):
    return llm.bind_tools(ARENA_TOOLS)


# ===== ReAct 模式 =====

def _react_node(state: AgentState) -> dict:
    """ReAct: 标准 Thought → Action → Observation 循环"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = llm_with_tools.invoke(state["messages"])
    return {"messages": [response], "step_count": state["step_count"] + 1}


def _react_tool_node(state: AgentState) -> dict:
    """执行工具调用"""

    last_msg = state["messages"][-1]
    tool_calls = last_msg.tool_calls if hasattr(last_msg, "tool_calls") else []

    results = []
    tc_count = state.get("tool_calls", 0)
    for call in tool_calls:
        tool_name = call["name"]
        tool_args = call["args"]
        tool_func = next((t for t in ARENA_TOOLS if t.name == tool_name), None)
        if tool_func:
            result = tool_func.invoke(tool_args)
            results.append(result)
            tc_count += 1

    from langchain_core.messages import ToolMessage
    tool_messages = [
        ToolMessage(content=str(r), tool_call_id=call["id"])
        for call, r in zip(tool_calls, results)
    ]
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
    graph.add_conditional_edges(
        "agent",
        _react_should_continue,
        {"tools": "tools", END: END}
    )
    return graph


# ===== CoT+Tool 模式 =====

def _cot_think_node(state: AgentState) -> dict:
    """CoT+Tool: 先完整推理，再统一调用工具"""
    llm = _create_llm()
    # 强制 LLM 先输出推理链，不调用工具
    think_prompt = state["messages"] + [
        SystemMessage(content="\n\n[阶段1: 推理]\n请先完整分析问题，列出所有需要的步骤和工具。不要调用工具，只输出推理过程。")
    ]
    response = llm.invoke(think_prompt)
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


def _cot_act_node(state: AgentState) -> dict:
    """CoT+Tool: 根据推理结果统一执行工具"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    act_prompt = state["messages"] + [
        SystemMessage(content="\n\n[阶段2: 行动]\n基于上述推理，现在执行所需的工具调用。")
    ]
    response = llm_with_tools.invoke(act_prompt)
    return {"messages": [response], "step_count": state["step_count"] + 1}


def _cot_tool_node(state: AgentState) -> dict:
    """执行工具调用（与 ReAct 相同）"""
    return _react_tool_node(state)


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

def _tot_generate_node(state: AgentState) -> dict:
    """ToT: 生成多个候选方案"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    gen_prompt = state["messages"] + [
        SystemMessage(content="\n\n[ToT: 生成候选]\n请生成 2-3 个不同的解决方案思路，分别评估每个方案的优劣。")
    ]
    response = llm_with_tools.invoke(gen_prompt)
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


def _tot_evaluate_node(state: AgentState) -> dict:
    """ToT: 评估并选择最优方案"""
    llm = _create_llm()
    eval_prompt = state["messages"] + [
        SystemMessage(content="\n\n[ToT: 评估选择]\n评估以上方案，选择最优的一个，然后执行。")
    ]
    response = llm_with_tools.invoke(eval_prompt)
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


def _tot_execute_node(state: AgentState) -> dict:
    """ToT: 执行选定方案的工具调用"""
    return _react_tool_node(state)


def _tot_should_continue(state: AgentState) -> str:
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return END


def build_tot_graph() -> StateGraph:
    """构建 ToT 图：generate → evaluate → execute → (循环)"""
    graph = StateGraph(AgentState)
    graph.add_node("generate", _tot_generate_node)
    graph.add_node("evaluate", _tot_evaluate_node)
    graph.add_node("execute", _tot_execute_node)
    graph.add_node("tools", _react_tool_node)
    graph.add_edge("generate", "evaluate")
    graph.add_conditional_edges("evaluate", _tot_should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "generate")
    graph.set_entry_point("generate")
    return graph


# ===== Reflexion 模式 =====

def _reflexion_execute_node(state: AgentState) -> dict:
    """Reflexion: 执行任务"""
    llm = _create_llm()
    llm_with_tools = _bind_tools(llm)
    response = llm_with_tools.invoke(state["messages"])
    return {
        "messages": [response],
        "step_count": state["step_count"] + 1,
    }


def _reflexion_reflect_node(state: AgentState) -> dict:
    """Reflexion: 反思结果质量"""
    llm = _create_llm()
    last_response = state["messages"][-1].content
    reflect_prompt = [
        SystemMessage(content="\n\n[Reflexion: 反思]\n评估以上回答的质量：\n1. 是否准确回答了问题？\n2. 是否有遗漏？\n3. 如何改进？\n\n输出反思结论。"),
        HumanMessage(content=f"回答内容：\n{last_response}")
    ]
    response = llm.invoke(reflect_prompt)
    return {
        "messages": [response],
        "reflections": state.get("reflections", []) + [response.content],
    }


def _reflexion_should_continue(state: AgentState) -> str:
    """判断是否需要重试"""
    if state["step_count"] >= state["max_steps"]:
        return END
    last_reflection = state.get("reflections", [])[-1] if state.get("reflections") else ""
    # 如果反思认为需要改进，继续重试
    if "改进" in last_reflection or "不足" in last_reflection or "重新" in last_reflection:
        return "execute"
    return END


def build_reflexion_graph() -> StateGraph:
    """构建 Reflexion 图：execute ↔ reflect 循环，重试到 max_steps 后退出。"""
    graph = StateGraph(AgentState)
    graph.add_node("execute", _reflexion_execute_node)
    graph.add_node("reflect", _reflexion_reflect_node)
    graph.add_edge("reflect", "execute")
    # 统一使用条件边控制：进入 reflect 后再决定是回到 execute 还是结束
    graph.set_conditional_entry_point(
        lambda state: "reflect" if state["step_count"] > 0 else "execute",
        {"reflect": "reflect", "execute": "execute"},
    )
    graph.add_conditional_edges(
        "reflect",
        _reflexion_should_continue,
        {"execute": "execute", END: END},
    )
    graph.add_edge("execute", "reflect")
    return graph


# ===== 图构建器入口 =====

def build_reasoning_graph(mode: ReasoningMode) -> StateGraph:
    """根据推理模式构建对应的 LangGraph 图"""
    builders = {
        "react": build_react_graph,
        "cot_tool": build_cot_tool_graph,
        "tot": build_tot_graph,
        "reflexion": build_reflexion_graph,
    }
    builder = builders.get(mode, build_react_graph)
    return builder()


def get_reasoning_graph(mode: ReasoningMode):
    """编译并返回可运行的图"""
    graph = build_reasoning_graph(mode)
    return graph.compile()
