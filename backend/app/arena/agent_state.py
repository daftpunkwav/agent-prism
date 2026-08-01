"""Agent 状态定义 — 跨推理图和 adapter 共享。"""

from __future__ import annotations

from typing import Annotated

from langgraph.graph.message import add_messages
from typing_extensions import NotRequired, TypedDict


class AgentState(TypedDict, total=False):
    """Agent 运行时状态。

    ``messages`` 必须使用 ``add_messages`` reducer，否则节点
    ``return {"messages": [...]}`` 会整表覆盖，丢失原始任务与历史。
    """

    messages: Annotated[list, add_messages]
    step_count: int  # 当前步数
    max_steps: int  # 最大步数
    tool_calls: int  # 工具调用次数
    reflections: list[str]  # 反思历史
    # 上下文策略（由 adapter 写入，供图节点在 LLM 调用前裁剪）
    context_strategy: NotRequired[str]
