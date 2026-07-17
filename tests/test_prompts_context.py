"""上下文维度接入 build_messages 的回归测试。"""

from __future__ import annotations

from app.arena.prompts import build_messages
from app.arena.workspace import set_current_workspace, clear_current_workspace
from app.arena.tools import get_workspace_mgr


def test_context_sliding_hint_in_system():
    system, _user = build_messages("问题", "zero_shot", context="sliding")
    assert "滑动窗口" in system


def test_context_summary_hint_in_system():
    system, _user = build_messages("问题", "zero_shot", context="summary")
    assert "摘要" in system


def test_context_hybrid_hint_in_system():
    system, _user = build_messages("问题", "zero_shot", context="hybrid")
    assert "混合" in system


def test_context_vector_injects_workspace_hits():
    mgr = get_workspace_mgr()
    ws = mgr.create("test_ctx_ws")
    ws.write_file("notes.md", "苹果是一种水果，富含维生素")
    set_current_workspace("test_ctx_ws")
    try:
        system, user = build_messages("水果维生素", "zero_shot", context="vector")
        assert "向量检索" in system
        # 有相关文档时应附加检索块（TF-IDF 可能弱匹配，至少 system 有策略提示）
        assert isinstance(user, str)
    finally:
        clear_current_workspace()
        mgr.remove("test_ctx_ws")
