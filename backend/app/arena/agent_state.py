"""Agent 状态定义 — 跨推理图和 adapter 共享。"""

from __future__ import annotations

from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    """Agent 运行时状态。"""

    messages: list  # LangChain 消息列表
    step_count: int  # 当前步数
    max_steps: int  # 最大步数
    tool_calls: int  # 工具调用次数
    reflections: list[str]  # 反思历史