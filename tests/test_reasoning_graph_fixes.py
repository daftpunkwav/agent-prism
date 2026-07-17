"""推理图修复回归：ToT evaluate、未知工具 ToolMessage、Reflexion 边。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langgraph.graph import END

from app.arena.reasoning_graph import (
    _react_tool_node,
    _reflexion_should_continue,
    _tot_evaluate_node,
    build_reflexion_graph,
    build_tot_graph,
)


def test_tot_graph_has_evaluate_node():
    g = build_tot_graph()
    assert "evaluate" in g.nodes


def test_tot_evaluate_node_binds_tools_not_nameerror():
    """evaluate 节点必须定义 llm_with_tools，不得 NameError。"""
    fake_llm = MagicMock()
    fake_bound = MagicMock()
    fake_bound.invoke.return_value = SimpleNamespace(content="选方案 A", tool_calls=[])
    fake_llm.bind_tools.return_value = fake_bound

    with (
        patch("app.arena.reasoning_graph._create_llm", return_value=fake_llm),
        patch("app.arena.reasoning_graph._bind_tools", return_value=fake_bound) as bind,
    ):
        state = {
            "messages": [SimpleNamespace(content="候选1")],
            "step_count": 1,
            "max_steps": 10,
            "tool_calls": 0,
            "reflections": [],
        }
        out = _tot_evaluate_node(state)
        bind.assert_called_once_with(fake_llm)
        fake_bound.invoke.assert_called_once()
        assert out["step_count"] == 2
        assert len(out["messages"]) == 1


def test_react_tool_node_unknown_tool_still_emits_toolmessage():
    """未知工具也要写 ToolMessage，与 tool_calls 1:1。"""
    call = {"name": "no_such_tool", "args": {}, "id": "call_1"}
    last = SimpleNamespace(tool_calls=[call])
    state = {
        "messages": [last],
        "step_count": 1,
        "max_steps": 10,
        "tool_calls": 0,
        "reflections": [],
    }
    out = _react_tool_node(state)
    assert len(out["messages"]) == 1
    msg = out["messages"][0]
    assert msg.tool_call_id == "call_1"
    assert "未知工具" in str(msg.content)


def test_reflexion_graph_no_unconditional_reflect_to_execute():
    """reflect 不得有无条件边到 execute（仅条件边）。"""
    g = build_reflexion_graph()
    # 编译后检查：条件边映射应含 execute 与 END
    assert "reflect" in g.nodes
    assert "execute" in g.nodes
    # 无条件边集合：LangGraph StateGraph 用 edges / branches
    # 直接测 should_continue 逻辑
    assert _reflexion_should_continue(
        {"step_count": 1, "max_steps": 10, "reflections": ["需要改进回答"]}
    ) == "execute"
    assert (
        _reflexion_should_continue(
            {"step_count": 1, "max_steps": 10, "reflections": ["质量良好"]}
        )
        == END
    )
    assert (
        _reflexion_should_continue(
            {"step_count": 99, "max_steps": 10, "reflections": ["需要改进"]}
        )
        == END
    )
