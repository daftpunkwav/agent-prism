"""上下文管理策略 — 滑动窗口、摘要压缩、混合策略。"""

from __future__ import annotations

from typing import Literal


ContextStrategy = Literal["sliding", "summary", "vector", "hybrid"]


class ContextManager:
    """管理对话上下文的生命周期。"""

    def __init__(
        self,
        strategy: ContextStrategy = "sliding",
        window_size: int = 10,
        summary_threshold: int = 8,
    ) -> None:
        self.strategy = strategy
        self.window_size = window_size
        self.summary_threshold = summary_threshold
        self._summary: str = ""
        self._messages: list[dict] = []

    def add_message(self, role: str, content: str) -> None:
        self._messages.append({"role": role, "content": content})

    def get_messages(self) -> list[dict]:
        if self.strategy == "sliding":
            return self._messages[-self.window_size:]
        if self.strategy == "summary":
            return self._apply_summary()
        if self.strategy == "hybrid":
            return self._apply_hybrid()
        return self._messages

    def reset(self) -> None:
        self._summary = ""
        self._messages = []

    def _apply_summary(self) -> list[dict]:
        if len(self._messages) <= self.window_size:
            return list(self._messages)
        # 保留最近 N 条，旧消息用摘要替代
        recent = self._messages[-self.window_size:]
        if not self._summary:
            old = self._messages[:-self.window_size]
            self._summary = self._summarize(old)
        if self._summary:
            return [{"role": "system", "content": f"[上下文摘要]\n{self._summary}"}] + recent
        return recent

    def _apply_hybrid(self) -> list[dict]:
        # 混合策略：滑动窗口 + 摘要
        # 保留最近 window_size 条，超出部分滚动摘要
        if len(self._messages) <= self.window_size:
            return list(self._messages)
        recent = self._messages[-self.window_size:]
        overflow = self._messages[:-self.window_size]
        new_summary = self._summarize(overflow)
        if self._summary:
            new_summary = self._summary + "\n" + new_summary
        self._summary = new_summary
        result: list[dict] = []
        if self._summary:
            result.append({"role": "system", "content": f"[上下文摘要]\n{self._summary}"})
        result.extend(recent)
        return result

    def _summarize(self, messages: list[dict]) -> str:
        """简单摘要：提取每轮的关键信息。"""
        if not messages:
            return ""
        lines: list[str] = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                lines.append(f"用户问: {content[:80]}")
            elif role == "assistant":
                lines.append(f"助手答: {content[:80]}")
            elif role == "tool":
                lines.append(f"工具结果: {content[:60]}")
        return "\n".join(lines)

    @property
    def message_count(self) -> int:
        return len(self._messages)
