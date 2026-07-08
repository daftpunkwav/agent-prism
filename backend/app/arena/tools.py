"""统一 Tool 集 — 所有框架 Adapter 共用。"""

from __future__ import annotations

from datetime import datetime, timezone

from langchain_core.tools import tool


@tool
def get_current_time() -> str:
    """获取当前 UTC 时间。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


@tool
def calculate(expression: str) -> str:
    """计算简单数学表达式，仅支持 + - * / 和括号。"""
    allowed = set("0123456789+-*/(). ")
    if not all(c in allowed for c in expression):
        return "错误：表达式含非法字符"
    try:
        result = eval(expression, {"__builtins__": {}}, {})  # noqa: S307
        return str(result)
    except Exception as exc:  # noqa: BLE001
        return f"计算错误: {exc}"


ARENA_TOOLS = [get_current_time, calculate]
