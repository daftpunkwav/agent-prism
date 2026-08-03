"""``adapters/_common_run`` 事件翻译层单元测试。

覆盖两个 adapter 共享的 raw 事件 → ArenaEvent 翻译逻辑（step 计数、
thought_end 收尾、token_update、harness 事件），此层此前无任何测试保护。
"""

from __future__ import annotations

from app.adapters._common_run import (
    RunState,
    emit_harness_event,
    emit_stream_event,
    finish_event,
)


def _state(**kw) -> RunState:
    return RunState(label="t", **kw)


# ===== emit_stream_event：on_chat_model_stream =====


def test_stream_thinking_and_text_assigns_steps():
    state = _state()
    chunk = {
        "event": "on_chat_model_stream",
        "data": {"chunk": {"content": [{"type": "thinking", "thinking": "想一下"}]}},
    }
    evts = emit_stream_event(state, chunk)
    assert len(evts) == 1
    assert evts[0].type == "thinking"
    assert evts[0].content == "想一下"
    assert evts[0].step == 1
    assert state.thinking_step == 1

    chunk2 = {
        "event": "on_chat_model_stream",
        "data": {"chunk": {"content": [{"type": "text", "text": "答案"}]}},
    }
    evts = emit_stream_event(state, chunk2)
    assert len(evts) == 1
    assert evts[0].type == "thought_delta"
    assert evts[0].content == "答案"
    assert evts[0].step == 2
    assert state.streaming_step == 2
    # thinking 与 text 各自独立 step
    assert state.thinking_step == 1


# ===== emit_stream_event：on_chat_model_end =====


def test_model_end_emits_token_update_and_thought_end():
    state = _state()
    state.streaming_step = 2
    state.thinking_step = 1
    usage = {"input_tokens": 100, "output_tokens": 50}
    evts = emit_stream_event(
        state,
        {
            "event": "on_chat_model_end",
            "data": {"output": type("O", (), {"usage_metadata": usage})()},
        },
    )
    types = [ev.type for ev in evts]
    assert "token_update" in types
    assert "thought_end" in types
    token_ev = next(ev for ev in evts if ev.type == "token_update")
    assert token_ev.token_stats["input_tokens"] == 100
    assert token_ev.workspace == ""
    # 收尾后 step 状态复位
    assert state.streaming_step is None
    assert state.thinking_step is None


def test_model_end_without_usage_skips_token_update():
    state = _state()
    evts = emit_stream_event(
        state,
        {"event": "on_chat_model_end", "data": {"output": type("O", (), {})()}},
    )
    assert all(ev.type != "token_update" for ev in evts)


# ===== emit_stream_event：on_tool_start / on_tool_end =====


def test_tool_start_emits_action_with_step_and_name_fallback():
    state = _state()
    state.streaming_step = 3
    # data 无 name → 回退 event.name；先收尾 thought_end 再发 action
    evts = emit_stream_event(
        state,
        {"event": "on_tool_start", "name": "write_file", "data": {"input": {"path": "a.txt"}}},
    )
    assert [ev.type for ev in evts] == ["thought_end", "action"]
    assert evts[0].step == 3
    ev = evts[1]
    assert ev.tool == "write_file"
    assert ev.args == {"path": "a.txt"}
    assert ev.step == 1  # 新 step 从 0 递增
    assert state.streaming_step is None
    assert state.tool_calls == 1
    # 非 dict 输入规范化为 {"input": ...}
    evts2 = emit_stream_event(
        state,
        {"event": "on_tool_start", "data": {"input": "raw"}},
    )
    assert evts2[0].args == {"input": "raw"}
    # 无 name 也无 node_name → 默认 "tool"
    evts3 = emit_stream_event(state, {"event": "on_tool_start", "data": {}})
    assert evts3[0].tool == "tool"


def test_tool_end_emits_observation():
    state = _state()
    evts = emit_stream_event(
        state,
        {"event": "on_tool_end", "data": {"output": "ok"}},
    )
    assert len(evts) == 1
    assert evts[0].type == "observation"
    assert evts[0].result == "ok"
    assert evts[0].step == 1


# ===== emit_stream_event：on_node_start =====


def test_node_start_phase_hint_and_exclusion():
    state = _state()
    evts = emit_stream_event(
        state,
        {"event": "on_node_start", "data": {}},
        node_name="think",
        node_start_excluded=frozenset(),
    )
    assert len(evts) == 1
    assert evts[0].type == "thought"
    assert "[阶段: think]" in evts[0].content

    # 排除集合内的骨架节点不产生提示
    evts = emit_stream_event(
        state,
        {"event": "on_node_start", "data": {}},
        node_name="agent",
        node_start_excluded=frozenset({"agent", "execute"}),
    )
    assert evts == []


# ===== emit_harness_event =====


def test_harness_event_translation_with_stream_close():
    state = _state()
    state.streaming_step = 2
    evts = emit_harness_event(
        state,
        {"_harness": True, "type": "verify", "passed": False, "content": "未通过"},
    )
    # 先收尾 thought_end，再发 verify
    assert [ev.type for ev in evts] == ["thought_end", "verify"]
    verify = evts[1]
    assert verify.passed is False
    assert verify.content == "未通过"
    assert verify.step == 1
    assert state.streaming_step is None


def test_harness_non_control_event_returns_empty():
    state = _state()
    assert emit_harness_event(state, {"event": "on_chat_model_stream", "data": {}}) == []
    assert emit_harness_event(state, {}) == []


def test_harness_default_type_verify():
    state = _state()
    evts = emit_harness_event(state, {"_harness": True, "passed": True})
    assert evts[-1].type == "verify"
    assert evts[-1].passed is True


# ===== finish_event =====


def test_finish_event_metrics():
    state = _state()
    state.tool_calls = 3
    state.step = 5
    state.ws_name = "ws1"
    ev = finish_event(state, success=True)
    assert ev.type == "complete"
    assert ev.workspace == "ws1"
    assert ev.metrics.success is True
    assert ev.metrics.tool_calls == 3
    assert ev.metrics.steps == 5
    assert ev.metrics.duration_ms >= 0
    assert ev.token_stats["total_tokens"] == 0


def test_finish_event_failure():
    state = _state()
    ev = finish_event(state, success=False)
    assert ev.type == "complete"
    assert ev.metrics.success is False
