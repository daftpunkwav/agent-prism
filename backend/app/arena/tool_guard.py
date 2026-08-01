"""工具调用相关性护栏 — 拦截明显偏离用户问题的 tool_calls。"""

from __future__ import annotations

import json
import re

__all__ = ["assess_tool_relevance"]

_TIME_HINTS = ("几点", "时间", "何时", "what time", "current time", "现在几点")
_SUM_HINTS = ("等于多少", "求和", "加到", "1+2", "sum")
_FILE_HINTS = ("写入", "保存", "html", "文件", "fib", ".txt", ".html", "创建")


def _norm(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def _args_blob(tool_args: dict) -> str:
    try:
        return json.dumps(tool_args, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(tool_args)


def _char_overlap_ratio(question: str, blob: str) -> float:
    """粗粒度重叠：问题中的汉字/英文词有多少出现在参数里。"""
    q = _norm(question)
    b = _norm(blob)
    if not q or not b:
        return 0.0
    # 抽 2-gram 汉字与英文片段
    grams: set[str] = set()
    for i in range(len(q) - 1):
        grams.add(q[i : i + 2])
    for m in re.findall(r"[a-z0-9_]{3,}", q):
        grams.add(m)
    if not grams:
        return 1.0
    hit = sum(1 for g in grams if g in b)
    return hit / len(grams)


def _is_time_question(question: str) -> bool:
    q = question.lower()
    return any(h in q for h in _TIME_HINTS)


def assess_tool_relevance(
    question: str,
    tool_name: str,
    tool_args: dict | None,
    *,
    prior_tool_names: list[str] | None = None,
) -> tuple[bool, str]:
    """判断工具调用是否与用户问题相关。

    返回 (allowed, reason)。拒绝时 reason 会写进 ToolMessage 供模型改正。
    """
    q = (question or "").strip()
    args = tool_args or {}
    prior = prior_tool_names or []
    blob = _args_blob(args)

    # 1) 时间类问题：只允许 get_current_time
    if _is_time_question(q):
        if tool_name != "get_current_time":
            return (
                False,
                f"护栏拒绝：用户问题是「{q}」，与工具 {tool_name} 无关。"
                "请直接根据已有观测回答时间，不要再调用其他工具。",
            )
        return True, ""

    # 2) 已有工具结果后，长参数写文件/跑代码若与问题几乎无重叠 → 视为跑题
    if prior and tool_name in {"write_file", "create_file", "append_file", "run_code", "calculate"}:
        overlap = _char_overlap_ratio(q, f"{tool_name}{blob}")
        # 问题本身在要求写文件/计算时放行
        needs_file = any(h in q.lower() for h in _FILE_HINTS)
        needs_calc = any(h in q.lower() for h in _SUM_HINTS) or "计算" in q
        if tool_name == "calculate" and needs_calc:
            return True, ""
        if tool_name in {"write_file", "create_file", "append_file", "run_code"} and needs_file:
            # 仍检查路径/内容是否完全跑题（重叠极低且内容很长）
            if len(blob) > 80 and overlap < 0.05:
                return (
                    False,
                    f"护栏拒绝：工具 {tool_name} 的参数与用户问题「{q}」几乎无关（疑似话题漂移）。"
                    "请回到原问题，不要开始新任务。",
                )
            return True, ""
        if overlap < 0.08 and len(blob) > 20:
            return (
                False,
                f"护栏拒绝：在已有工具结果后调用 {tool_name} 偏离了用户问题「{q}」。"
                "若原问题已能回答请直接给出最终答案。",
            )

    # 3) write_file 内容提到完全不同的竞赛题/项目且问题未提及
    if tool_name in {"write_file", "create_file"} and prior:
        markers = ("euler", "欧拉", "project euler", "todo", "待办", "phi_ascii", "斐波那契")
        # 斐波那契若问题包含则放行
        lower_blob = blob.lower()
        lower_q = q.lower()
        for m in markers:
            if m in lower_blob and m not in lower_q and "fib" not in lower_q and "斐波那契" not in q:
                return (
                    False,
                    f"护栏拒绝：试图写入与用户问题无关的内容（检测到「{m}」）。"
                    f"用户问题是「{q}」。",
                )

    return True, ""
