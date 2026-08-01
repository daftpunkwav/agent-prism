"""LLM 消息消毒与任务锚定 — 防止 thinking/tool_use 历史污染导致跑偏。"""

from __future__ import annotations

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

__all__ = [
    "sanitize_messages_for_model",
    "extract_original_question",
    "reinforce_system_with_question",
    "inject_tool_result_reminder",
    "with_tool_grounding",
]


def _text_from_content(content: object) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            elif hasattr(block, "type") and getattr(block, "type", None) == "text":
                parts.append(str(getattr(block, "text", "") or ""))
        return "".join(parts)
    return str(content)


def sanitize_ai_message(msg: AIMessage) -> AIMessage:
    """历史回传时去掉 thinking / tool_use 内容块，仅保留可见文本 + tool_calls。

    StepFun 等 Anthropic 兼容接口在多轮中回传 thinking signature / 内嵌 tool_use
    时不稳定，易在工具结果后生成无关长文。tool_calls 仍走标准字段。
    """
    text = _text_from_content(msg.content)
    tool_calls = getattr(msg, "tool_calls", None) or []
    # 空 content + tool_calls 会导致部分兼容接口「丢失助手轮」进而胡言
    if tool_calls and not str(text).strip():
        names = ", ".join(str(c.get("name") or "?") for c in tool_calls)
        text = f"（调用工具: {names}）"
    return AIMessage(
        content=text,
        tool_calls=tool_calls,
        id=getattr(msg, "id", None),
        name=getattr(msg, "name", None),
        additional_kwargs={},
    )


def sanitize_messages_for_model(messages: list) -> list[BaseMessage]:
    """对即将送入 LLM 的消息做消毒（不修改 state 内原件）。"""
    out: list[BaseMessage] = []
    for m in messages:
        if isinstance(m, AIMessage):
            out.append(sanitize_ai_message(m))
        else:
            out.append(m)
    return out


def extract_original_question(messages: list) -> str:
    """取第一条「非锚定」HumanMessage 作为用户原始问题。"""
    for m in messages:
        if isinstance(m, HumanMessage):
            text = _text_from_content(m.content).strip()
            if text.startswith("[任务锚定]"):
                continue
            return text
    return ""


def reinforce_system_with_question(messages: list, question: str) -> list[BaseMessage]:
    """每次调用前把唯一任务写进首条 System，强化不跑题。"""
    if not messages or not question.strip():
        return list(messages)
    out = list(messages)
    anchor = (
        f"\n\n[唯一任务] {question.strip()}\n"
        "完成该任务后停止。禁止开始任何新话题或新任务。"
    )
    first = out[0]
    if isinstance(first, SystemMessage):
        content = _text_from_content(first.content)
        if "[唯一任务]" not in content:
            out[0] = SystemMessage(content=content + anchor)
    return out


def inject_tool_result_reminder(result: str, question: str) -> str:
    """把锚定塞进 ToolMessage，避免额外 HumanMessage 造成双 user 轮。"""
    q = question.strip() or "（未知）"
    return (
        f"{result}\n\n"
        f"—\n[任务锚定] 用户原始问题：{q}\n"
        "若已足够回答请给出最终答案并停止；不要开启新任务。"
    )


def with_tool_grounding(messages: list) -> list[BaseMessage]:
    """兼容保留：不再追加尾部 Human；锚定已写入 ToolMessage / System。"""
    question = extract_original_question(messages)
    return reinforce_system_with_question(list(messages), question)
