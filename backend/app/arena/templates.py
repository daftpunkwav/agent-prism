"""任务模板库 — 预置可自动判分的 Arena 任务。

每个模板附带 ``judge`` 判分规则（见 :mod:`app.arena.judging`），
运行完成后前端可一键判分所有列，实现 PRD §2.2 的「可自动判分」能力。

模板覆盖典型 Agent 场景：
- 结构化输出（json）
- 数学计算（numeric）
- 代码生成（code）
- 知识检索（keyword）
- 鲁棒性（exclude）
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.arena.judging import JudgeSpec
from app.arena.types import DimensionId


class TaskTemplate(BaseModel):
    """任务模板定义。"""

    id: str
    name: str
    description: str
    question: str
    # 建议的对比维度与预选项（前端可一键预填）
    suggested_dimension: DimensionId = "framework"
    suggested_selections: list[str] = Field(default_factory=list)
    judge: JudgeSpec


# ===== 预置模板 =====

TEMPLATES: list[TaskTemplate] = [
    TaskTemplate(
        id="json_profile",
        name="JSON 结构化输出",
        description="考察模型是否遵从 JSON 输出约束（L1 格式验证）",
        question="请输出一个 JSON 对象，包含 name（字符串）、age（数字）、hobbies（字符串数组）三个字段，不要输出其他内容。",
        suggested_dimension="prompt",
        suggested_selections=["zero_shot", "structured"],
        judge=JudgeSpec(
            type="json",
            required_fields=["name", "age", "hobbies"],
        ),
    ),
    TaskTemplate(
        id="arithmetic_mix",
        name="混合算术",
        description="考察多步数学计算的准确性（可自动判分）",
        question="计算 (128 + 64) * 2 的结果，直接给出数字。",
        suggested_dimension="reasoning",
        suggested_selections=["react", "cot_tool"],
        judge=JudgeSpec(type="numeric", operator="==", value=384, tolerance=0.001),
    ),
    TaskTemplate(
        id="prime_count",
        name="100 以内质数",
        description="多步推理题，答案可自动判分（100 以内有 25 个质数）",
        question="100 以内（含 100）一共有多少个质数？只回答数字。",
        suggested_dimension="reasoning",
        suggested_selections=["react", "reflexion"],
        judge=JudgeSpec(type="numeric", operator="==", value=25, tolerance=0.001),
    ),
    TaskTemplate(
        id="fibonacci_code",
        name="斐波那契函数",
        description="考察代码生成的语法正确性与结构完整性",
        question="用 Python 写一个函数 fib(n)，返回斐波那契数列第 n 项（n 从 0 开始，fib(0)=0）。只输出代码。",
        suggested_dimension="framework",
        suggested_selections=["langchain", "langgraph"],
        judge=JudgeSpec(
            type="code",
            must_contain=["def fib"],
            max_len=6000,
        ),
    ),
    TaskTemplate(
        id="builtin_types",
        name="Python 内置数据结构",
        description="知识检索题：答案中出现至少 2 个内置数据结构名即通过",
        question="请列出 Python 的 3 个内置数据结构（如 list、dict 等）。",
        suggested_dimension="prompt",
        suggested_selections=["zero_shot", "few_shot"],
        judge=JudgeSpec(
            type="keyword",
            any_of=["list", "dict", "set", "tuple", "str", "int", "float", "bytes"],
            min_hits=3,
        ),
    ),
    TaskTemplate(
        id="no_refusal",
        name="拒绝检测",
        description="鲁棒性：模型不应以'无法回答'等方式拒绝简单问题",
        question="请用一句话解释什么是递归。不要回答'无法回答'或类似内容。",
        suggested_dimension="harness",
        suggested_selections=["bare", "verify"],
        judge=JudgeSpec(
            type="exclude",
            patterns=["无法", "不能回答", "抱歉", "sorry", "不清楚"],
        ),
    ),
    TaskTemplate(
        id="time_until_midnight",
        name="距离午夜分钟数",
        description="工具组合题：需调用 get_current_time 获取时间并计算",
        question="获取当前 UTC 时间，并计算距离下一个午夜还有多少分钟。请给出计算过程和结果。",
        suggested_dimension="context",
        suggested_selections=["sliding", "vector"],
        judge=JudgeSpec(
            type="regex",
            pattern=r"\d{1,4}(\.\d+)?\s*(分钟|min)",
        ),
    ),
    TaskTemplate(
        id="string_reverse",
        name="字符串反转",
        description="代码题：反转 'AgentPrism' 并解释思路",
        question="写一段 Python 代码把字符串 'AgentPrism' 反转，并解释你的思路。",
        suggested_dimension="framework",
        suggested_selections=["langchain", "langgraph"],
        judge=JudgeSpec(
            type="code",
            must_contain=["AgentPrism"],
            max_len=6000,
        ),
    ),
]

_TEMPLATE_MAP: dict[str, TaskTemplate] = {t.id: t for t in TEMPLATES}


def list_templates() -> list[TaskTemplate]:
    """返回全部模板。"""
    return list(TEMPLATES)


def get_template(template_id: str) -> TaskTemplate | None:
    """按 id 获取模板。"""
    return _TEMPLATE_MAP.get(template_id)


def template_payloads() -> list[dict[str, Any]]:
    """序列化模板（供 API 返回，judge 规则包含在内）。"""
    return [t.model_dump() for t in TEMPLATES]