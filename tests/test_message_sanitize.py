"""消息消毒与任务锚定单元测试。"""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.arena.message_sanitize import (
    inject_tool_result_reminder,
    reinforce_system_with_question,
    sanitize_ai_message,
    sanitize_messages_for_model,
    with_tool_grounding,
)
from app.arena.tool_guard import assess_tool_relevance


def test_sanitize_strips_thinking_and_tool_use_keeps_tool_calls():
    ai = AIMessage(
        content=[
            {"type": "thinking", "thinking": "内心独白", "signature": "abc"},
            {"type": "tool_use", "id": "c1", "name": "get_current_time", "input": {}},
            {"type": "text", "text": "可见文本"},
        ],
        tool_calls=[{"name": "get_current_time", "args": {}, "id": "c1", "type": "tool_call"}],
    )
    out = sanitize_ai_message(ai)
    assert out.content == "可见文本"
    assert out.tool_calls and out.tool_calls[0]["name"] == "get_current_time"


def test_sanitize_empty_content_with_tool_calls_gets_placeholder():
    ai = AIMessage(
        content=[],
        tool_calls=[{"name": "get_current_time", "args": {}, "id": "1", "type": "tool_call"}],
    )
    out = sanitize_ai_message(ai)
    assert "get_current_time" in out.content


def test_with_tool_grounding_reinforces_system():
    msgs = [
        SystemMessage(content="sys"),
        HumanMessage(content="现在几点？"),
        AIMessage(content="（调用工具）", tool_calls=[{"name": "get_current_time", "args": {}, "id": "1"}]),
        ToolMessage(content="2026-08-01 12:00:00 UTC", tool_call_id="1"),
    ]
    out = with_tool_grounding(msgs)
    assert isinstance(out[0], SystemMessage)
    assert "唯一任务" in out[0].content
    assert "现在几点？" in out[0].content
    # 不再追加尾部 HumanMessage
    assert not any(
        isinstance(m, HumanMessage) and str(m.content).startswith("[任务锚定]") for m in out
    )


def test_inject_tool_result_reminder():
    text = inject_tool_result_reminder("16:00 UTC", "现在几点？")
    assert "16:00 UTC" in text
    assert "现在几点？" in text
    assert "任务锚定" in text


def test_reinforce_system_idempotent():
    msgs = [SystemMessage(content="sys"), HumanMessage(content="q")]
    once = reinforce_system_with_question(msgs, "q")
    twice = reinforce_system_with_question(once, "q")
    assert twice[0].content.count("[唯一任务]") == 1


def test_guard_rejects_calculate_on_time_question():
    ok, reason = assess_tool_relevance("现在几点？", "calculate", {"expression": "1+2"})
    assert ok is False
    assert "护栏拒绝" in reason


def test_guard_allows_get_current_time_on_time_question():
    ok, _reason = assess_tool_relevance("现在几点？", "get_current_time", {"time_format": "readable"})
    assert ok is True


def test_guard_allows_fibonacci_write():
    q = "用代码生成斐波那契数列前 20 项，写入 fib.txt"
    ok1, _ = assess_tool_relevance(q, "run_code", {"code": "print(1)"})
    assert ok1 is True
    ok2, _ = assess_tool_relevance(
        q,
        "write_file",
        {"path": "fib.txt", "content": "[0, 1, 1]"},
        prior_tool_names=["run_code"],
    )
    assert ok2 is True


def test_guard_rejects_euler_html_after_time_tool():
    ok, reason = assess_tool_relevance(
        "现在几点？",
        "write_file",
        {"path": "euler_project_6.html", "content": "<html>欧拉计划</html>"},
        prior_tool_names=["get_current_time"],
    )
    assert ok is False
    assert "护栏拒绝" in reason


def test_sanitize_messages_for_model_preserves_human():
    msgs = [
        SystemMessage(content="s"),
        HumanMessage(content="q"),
        AIMessage(
            content=[{"type": "thinking", "thinking": "x"}, {"type": "text", "text": "y"}],
            tool_calls=[],
        ),
    ]
    out = sanitize_messages_for_model(msgs)
    assert out[1].content == "q"
    assert out[2].content == "y"


def test_flatten_non_consecutive_system_messages():
    """尾部/中段 System 必须压平，否则 Anthropic 抛 ValueError。"""
    from app.arena.message_sanitize import flatten_system_messages_for_provider

    msgs = [
        SystemMessage(content="sys-a"),
        SystemMessage(content="sys-b"),
        HumanMessage(content="q"),
        AIMessage(content="a"),
        SystemMessage(content="阶段提示"),
    ]
    out = flatten_system_messages_for_provider(msgs)
    systems = [m for m in out if isinstance(m, SystemMessage)]
    assert len(systems) == 1
    assert "sys-a" in systems[0].content
    assert "sys-b" in systems[0].content
    assert isinstance(out[0], SystemMessage)
    assert any(
        isinstance(m, HumanMessage) and "阶段提示" in str(m.content) for m in out
    )
    # sanitize 路径同样压平
    out2 = sanitize_messages_for_model(msgs)
    assert sum(1 for m in out2 if isinstance(m, SystemMessage)) == 1


def test_prepare_vector_appends_human_not_trailing_system():
    from unittest.mock import patch

    from app.arena.context_manager import prepare_messages_for_llm

    msgs = [
        SystemMessage(content="sys"),
        HumanMessage(content="查水果维生素"),
    ]
    with patch(
        "app.arena.context_manager.maybe_vector_snippets",
        return_value="苹果含维生素 C",
    ):
        out = prepare_messages_for_llm(msgs, strategy="vector", window_size=10)
    assert isinstance(out[0], SystemMessage)
    trailing_systems = [m for m in out[1:] if isinstance(m, SystemMessage)]
    assert trailing_systems == []
    assert any(isinstance(m, HumanMessage) and "维生素" in str(m.content) for m in out)
