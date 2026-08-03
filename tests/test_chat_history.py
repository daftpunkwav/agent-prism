"""多轮对话历史接入测试。"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import ValidationError

from app.adapters._common_run import build_initial_lc_messages
from app.models import ArenaRunRequest, ChatMessage


def test_build_initial_lc_messages_with_history():
    msgs = build_initial_lc_messages(
        "sys",
        "本轮问题",
        [
            ChatMessage(role="user", content="上一轮问"),
            ChatMessage(role="assistant", content="上一轮答"),
        ],
    )
    assert isinstance(msgs[0], SystemMessage)
    assert msgs[0].content == "sys"
    assert isinstance(msgs[1], HumanMessage)
    assert msgs[1].content == "上一轮问"
    assert isinstance(msgs[2], AIMessage)
    assert msgs[2].content == "上一轮答"
    assert isinstance(msgs[3], HumanMessage)
    assert msgs[3].content == "本轮问题"


def test_build_initial_lc_messages_empty_history():
    msgs = build_initial_lc_messages("sys", "q", None)
    assert len(msgs) == 2
    assert msgs[1].content == "q"


def test_arena_run_request_messages_ok():
    req = ArenaRunRequest(
        question="继续",
        messages=[
            ChatMessage(role="user", content="你好"),
            ChatMessage(role="assistant", content="你好！"),
        ],
    )
    assert len(req.messages) == 2


def test_arena_run_request_messages_must_pair():
    with pytest.raises(ValidationError):
        ArenaRunRequest(
            question="继续",
            messages=[ChatMessage(role="user", content="只有用户")],
        )


def test_arena_run_request_messages_total_cap():
    with pytest.raises(ValidationError):
        ArenaRunRequest(
            question="x" * 100,
            messages=[
                ChatMessage(role="user", content="a" * 4000),
                ChatMessage(role="assistant", content="b" * 4000),
                ChatMessage(role="user", content="c" * 4000),
                ChatMessage(role="assistant", content="d" * 4000),
                ChatMessage(role="user", content="e" * 4000),
                ChatMessage(role="assistant", content="f" * 4000),
            ],
        )
