"""Prompt Profile 模板 — 控制变量法下仅切换 Prompt 层。"""

from __future__ import annotations

from app.arena.harness import HarnessLevel, apply_harness_level
from app.arena.reasoning import ReasoningMode, apply_reasoning_mode
from app.models import PromptProfile

BASE_SYSTEM = """你是 AgentPrism Arena 中的实验 Agent，使用 ReAct 模式完成任务。
可用工具：get_current_time（获取当前时间）、calculate（计算简单数学表达式）、write_file/create_file/read_file/list_files（文件操作）、run_code（代码执行）。
回答要简洁准确。需要工具时先说明理由再调用。"""

PROFILES: dict[PromptProfile, dict[str, str]] = {
    "zero_shot": {
        "system": BASE_SYSTEM,
        "user_suffix": "",
    },
    "few_shot": {
        "system": BASE_SYSTEM,
        "user_suffix": """
参考示例：
Q: 现在几点？ → Thought: 需要当前时间 → Action: get_current_time → 回答用户
Q: 计算 12*8 → Thought: 需要计算 → Action: calculate(12*8) → 回答 96
""",
    },
    "cot_prompt": {
        "system": BASE_SYSTEM + "\n请始终先逐步推理（Thought），再决定 Action。",
        "user_suffix": "\nLet's think step by step.",
    },
    "structured": {
        "system": BASE_SYSTEM
        + """
最终回答必须是 JSON：
{"reasoning": "...", "answer": "...", "tools_used": ["..."]}
""",
        "user_suffix": "\n以 JSON 格式输出最终结果。",
    },
}


_CONTEXT_HINTS: dict[str, str] = {
    "sliding": "\n[上下文策略: 滑动窗口] 优先使用最近对话，丢弃过旧轮次。",
    "summary": "\n[上下文策略: 摘要压缩] 对过旧轮次做摘要后再回答。",
    "vector": "\n[上下文策略: 向量检索] 优先检索工作空间与历史中的相关片段再作答。",
    "hybrid": "\n[上下文策略: 混合] 结合滑动窗口与摘要/检索。",
}


def build_messages(
    question: str,
    profile: PromptProfile,
    reasoning: ReasoningMode = "react",
    harness: HarnessLevel = "bare",
    context: str = "sliding",
) -> tuple[str, str]:
    """构建 system + user prompt，集成推理模式、Harness 与上下文策略。"""
    cfg = PROFILES[profile]
    system = cfg["system"]
    user = question.strip() + cfg["user_suffix"]

    system, user = apply_reasoning_mode(system, user, reasoning)
    system, user = apply_harness_level(system, user, harness)

    # 将上下文策略注入 system，使「上下文」维度配置在执行路径上可观测
    hint = _CONTEXT_HINTS.get(context)
    if hint:
        system = system + hint
        if context == "vector":
            # 轻量 RAG：若工作空间有文件，把相关片段附加到 user
            try:
                from app.arena.rag import SimpleVectorStore
                from app.arena.tools import get_workspace_mgr
                from app.arena.workspace import get_current_workspace_name

                ws_name = get_current_workspace_name()
                ws = get_workspace_mgr().get(ws_name) if ws_name else None
                if ws and ws.files:
                    store = SimpleVectorStore()
                    docs = [
                        f"{path}\n{f.content}"
                        for path, f in ws.files.items()
                        if f.content and not path.endswith(".gitkeep")
                    ]
                    if docs:
                        store.add_documents(docs)
                        hits = store.query(question, top_k=3)
                        if hits:
                            snippets = [h["content"] for h in hits if h.get("content")]
                            if snippets:
                                user = (
                                    user
                                    + "\n\n[检索到的相关上下文]\n"
                                    + "\n---\n".join(snippets)
                                )
            except Exception:  # noqa: BLE001
                pass

    return system, user
