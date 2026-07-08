"""流式 chunk 文本提取。"""

from __future__ import annotations


def extract_chunk_text(chunk) -> str:
    """从多种 chunk 格式提取纯文本。"""
    if chunk is None:
        return ""

    # 1. 优先从 .content 属性提取
    content = getattr(chunk, "content", None)
    if content is not None:
        return _extract_from_content(content)

    # 2. 回退：尝试 .text 属性（部分 provider 直接返回字符串）
    text = getattr(chunk, "text", None)
    if isinstance(text, str) and text:
        return text

    # 3. 最后兜底：str() 转换
    return str(chunk) if chunk else ""


def _extract_from_content(content) -> str:
    """递归提取 content 中的文本块。"""
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return str(content) if content else ""

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
            continue
        if isinstance(block, dict):
            block_type = block.get("type", "")
            if block_type in ("text",):
                parts.append(str(block.get("text", "")))
            elif block_type in ("thinking", "reasoning", "redacted_thinking"):
                # extended thinking 的内容块也计入推理文本
                parts.append(str(block.get("thinking", block.get("text", ""))))
        else:
            text = getattr(block, "text", None)
            thinking = getattr(block, "thinking", None)
            if thinking:
                parts.append(str(thinking))
            elif text:
                parts.append(str(text))

    return "".join(parts)
