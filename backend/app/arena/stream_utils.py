"""流式 chunk 文本提取 — 区分 thinking 与可见回答。"""

from __future__ import annotations


def extract_chunk_text(chunk) -> str:
    """兼容旧接口：合并 thinking + 可见文本（不推荐用于主回答展示）。"""
    thinking, text = extract_chunk_parts(chunk)
    return f"{thinking}{text}"


def extract_chunk_parts(chunk) -> tuple[str, str]:
    """从 chunk 分离 (thinking_text, visible_text)。

    Provider（如 StepFun / Anthropic extended thinking）常把内心独白放在
    ``thinking`` 块；若并入主回答，UI 会把跑偏的独白当成最终答案。
    """
    if chunk is None:
        return "", ""

    if isinstance(chunk, dict):
        choices = chunk.get("choices")
        if isinstance(choices, list) and choices:
            delta = choices[0].get("delta", {})
            if isinstance(delta, dict):
                content = delta.get("content")
                if isinstance(content, str):
                    return "", content
                if isinstance(content, list):
                    return _parts_from_content(content)
                # 部分兼容接口把 reasoning 放在 delta.reasoning
                reasoning = delta.get("reasoning") or delta.get("reasoning_content")
                if isinstance(reasoning, str) and reasoning:
                    return reasoning, ""
        for key in ("text", "content"):
            val = chunk.get(key)
            if isinstance(val, str) and val:
                return "", val
            if isinstance(val, list):
                return _parts_from_content(val)
        return "", ""

    content = getattr(chunk, "content", None)
    if content is not None:
        return _parts_from_content(content)

    text = getattr(chunk, "text", None)
    if isinstance(text, str) and text:
        return "", text

    return "", str(chunk) if chunk else ""


def _parts_from_content(content) -> tuple[str, str]:
    if isinstance(content, str):
        return "", content
    if not isinstance(content, list):
        return "", str(content) if content else ""

    thinking_parts: list[str] = []
    text_parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            text_parts.append(block)
            continue
        if isinstance(block, dict):
            block_type = block.get("type", "")
            if block_type in ("thinking", "reasoning", "redacted_thinking"):
                thinking_parts.append(str(block.get("thinking", block.get("text", ""))))
            elif block_type in ("text",):
                text_parts.append(str(block.get("text", "")))
            elif block_type in ("tool_use", "tool_call", "input_json_delta"):
                continue
            else:
                # 未知块：若有 text 则归可见，否则忽略
                if block.get("text"):
                    text_parts.append(str(block["text"]))
            continue
        thinking = getattr(block, "thinking", None)
        text = getattr(block, "text", None)
        btype = getattr(block, "type", None)
        if thinking or btype in ("thinking", "reasoning"):
            thinking_parts.append(str(thinking or ""))
        elif text:
            text_parts.append(str(text))
    return "".join(thinking_parts), "".join(text_parts)
