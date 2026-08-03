"""对外错误消息脱敏 — 避免 API Key / endpoint 等敏感信息进入 SSE 或 HTTP 响应。"""

from __future__ import annotations


def sanitize_error_message(exc: BaseException) -> str:
    """仅返回异常类型名；详细原因应通过 logger.exception 记录。"""
    return type(exc).__name__
