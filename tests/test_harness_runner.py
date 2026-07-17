"""Harness 引擎的单元测试。"""

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from app.arena.harness import (
    HarnessRunner,
    _extract_answer_and_tool_calls,
    _pick_final_state,
    apply_harness_level,
    get_harness_description,
)


def test_apply_harness_level_bare():
    sys, usr = apply_harness_level("base", "Q?", "bare")
    assert sys == "base"
    assert usr == "Q?"


def test_apply_harness_level_verify():
    sys, _ = apply_harness_level("base", "Q?", "verify")
    assert "验证" in sys


def test_apply_harness_level_reflect():
    sys, _ = apply_harness_level("base", "Q?", "reflect")
    assert "反思" in sys


def test_apply_harness_level_self_evolve():
    sys, _ = apply_harness_level("base", "Q?", "self_evolve")
    assert "进化" in sys


def test_get_harness_description():
    for level in ("bare", "verify", "reflect", "self_evolve"):
        desc = get_harness_description(level)
        assert len(desc) > 0


def test_harness_runner_bare_single_attempt():
    """bare 级别 max_retries=1（单次运行，非 0）。"""
    runner = HarnessRunner(level="bare")
    assert runner.max_retries == 1
    assert runner.attempts == 0


def test_harness_runner_verify_has_retries():
    runner = HarnessRunner(level="verify")
    assert runner.max_retries == 2


def test_harness_runner_reflect_has_retries():
    runner = HarnessRunner(level="reflect")
    assert runner.max_retries == 2


def test_harness_runner_self_evolve_has_retries():
    runner = HarnessRunner(level="self_evolve")
    assert runner.max_retries == 2


def test_harness_runner_tracks_reflections():
    runner = HarnessRunner(level="reflect")
    runner.reflections.append("test insight")
    assert "test insight" in runner.reflections


def test_harness_runner_tracks_edits():
    runner = HarnessRunner(level="self_evolve")
    edit = {"prompt_additions": ["添加示例"], "reasoning": "改进回答"}
    runner.harness_edits.append(edit)
    assert runner.harness_edits[0]["prompt_additions"] == ["添加示例"]


def test_extract_answer_and_tool_calls():
    msg = SimpleNamespace(content="最终答案")
    answer, tc, messages = _extract_answer_and_tool_calls(
        {"messages": [msg], "tool_calls": 3}
    )
    assert answer == "最终答案"
    assert tc == 3
    assert messages == [msg]


def test_pick_final_state_prefers_messages():
    current = {"foo": 1}
    event = {
        "event": "on_chain_end",
        "data": {"output": {"messages": ["m"], "tool_calls": 1}},
    }
    picked = _pick_final_state(event, current)
    assert picked is not None
    assert "messages" in picked


def test_stream_events_bare_forwards_graph_events():
    """bare：原样转发图事件，不产生 _harness 事件。"""
    runner = HarnessRunner(level="bare")

    async def fake_astream_events(state, version="v2"):
        yield {"event": "on_chat_model_stream", "data": {"chunk": "x"}}
        yield {
            "event": "on_chain_end",
            "data": {"output": {"messages": [SimpleNamespace(content="ok")], "tool_calls": 0}},
        }

    async def _collect():
        graph = SimpleNamespace(astream_events=fake_astream_events)
        events = []
        async for ev in runner.stream_events("Q?", graph, {"messages": []}):
            events.append(ev)
        return events

    events = asyncio.run(_collect())
    assert len(events) == 2
    assert all(not (isinstance(e, dict) and e.get("_harness")) for e in events)
    assert runner.attempts == 1
    assert runner.final_state.get("messages")


def test_stream_events_verify_retries_on_fail():
    """verify：首次未通过时会重跑，并产出 verify harness 事件。"""
    runner = HarnessRunner(level="verify")
    call_count = {"n": 0}

    async def fake_astream_events(state, version="v2"):
        call_count["n"] += 1
        yield {
            "event": "on_chain_end",
            "data": {
                "output": {
                    "messages": [SimpleNamespace(content=f"ans-{call_count['n']}")],
                    "tool_calls": 0,
                }
            },
        }

    async def _collect():
        graph = SimpleNamespace(astream_events=fake_astream_events)
        with patch("app.arena.harness.verify_result") as mock_verify:
            mock_verify.side_effect = [(False, "差"), (True, "好")]
            events = []
            async for ev in runner.stream_events(
                "Q?", graph, {"messages": [], "step_count": 0}
            ):
                events.append(ev)
            return events

    events = asyncio.run(_collect())
    harness_events = [e for e in events if isinstance(e, dict) and e.get("_harness")]
    assert call_count["n"] == 2
    assert len(harness_events) == 2
    assert harness_events[0]["type"] == "verify"
    assert harness_events[0]["passed"] is False
    assert harness_events[1]["passed"] is True

