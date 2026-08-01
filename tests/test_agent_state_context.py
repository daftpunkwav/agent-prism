"""AgentState 消息累积与 ContextManager 裁剪回归。"""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.arena.agent_state import AgentState
from app.arena.context_manager import prepare_messages_for_llm
from app.arena.reasoning_graph import build_react_graph


def test_agent_state_messages_uses_add_messages_annotation():
    from typing import get_args, get_origin, get_type_hints

    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    ann = hints["messages"]
    # Annotated[list, add_messages]
    assert get_origin(ann) is not None or getattr(ann, "__metadata__", None)
    meta = getattr(ann, "__metadata__", None) or get_args(ann)[1:]
    assert meta
    assert any(callable(m) for m in meta)


def test_react_graph_accumulates_messages_not_overwrite():
    """无真实 LLM：用编译图 + 手动更新验证 reducer 行为。"""
    from langgraph.graph.message import add_messages

    # 直接验证 reducer：后写应追加而非覆盖
    merged = add_messages(
        [SystemMessage(content="sys"), HumanMessage(content="写 fib.txt")],
        [AIMessage(content="ok", tool_calls=[{"name": "run_code", "args": {}, "id": "1"}])],
    )
    assert len(merged) == 3
    assert merged[1].content == "写 fib.txt"

    merged2 = add_messages(
        merged,
        [ToolMessage(content="[0,1,1]", tool_call_id="1")],
    )
    assert len(merged2) == 4
    assert any(getattr(m, "content", "") == "写 fib.txt" for m in merged2)


def test_prepare_messages_sliding_keeps_system_and_trims():
    msgs = [SystemMessage(content="system")] + [
        HumanMessage(content=f"u{i}") for i in range(20)
    ]
    out = prepare_messages_for_llm(msgs, strategy="sliding", window_size=5)
    assert isinstance(out[0], SystemMessage)
    assert out[0].content == "system"
    assert len(out) <= 6  # system + <=5


def test_prepare_messages_summary_injects_summary_block():
    msgs = [SystemMessage(content="system")] + [
        HumanMessage(content=f"问{i}") for i in range(15)
    ]
    out = prepare_messages_for_llm(msgs, strategy="summary", window_size=4)
    assert any(
        isinstance(m, SystemMessage) and "[上下文摘要]" in str(m.content) for m in out
    )


def test_prepare_messages_preserves_tool_pairs():
    msgs = [
        SystemMessage(content="sys"),
        HumanMessage(content="task"),
        AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "c1"}]),
        ToolMessage(content="result", tool_call_id="c1"),
        HumanMessage(content="follow"),
    ]
    # window 切到 ToolMessage 中间时仍应带上 AI tool_calls
    out = prepare_messages_for_llm(msgs, strategy="sliding", window_size=2)
    texts = [type(m).__name__ for m in out]
    assert "SystemMessage" in texts
    # 不应孤立留下 ToolMessage 而无前置 AI
    tool_idxs = [i for i, m in enumerate(out) if isinstance(m, ToolMessage)]
    for i in tool_idxs:
        assert i > 0
        assert isinstance(out[i - 1], AIMessage) or _has_prior_ai(out, i)


def _has_prior_ai(msgs: list, tool_idx: int) -> bool:
    for j in range(tool_idx - 1, -1, -1):
        if isinstance(msgs[j], AIMessage):
            return True
        if isinstance(msgs[j], HumanMessage):
            return False
    return False


def test_react_graph_builds_with_agent_state():
    g = build_react_graph()
    compiled = g.compile()
    assert compiled is not None
