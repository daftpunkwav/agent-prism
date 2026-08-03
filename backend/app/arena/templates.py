"""任务模板库 — 预置 Arena 任务（可判分 + 快题）。

每个模板附带 ``judge`` 判分规则（见 :mod:`app.arena.judging`），
``category="scored"`` 可自动判分；``category="quick"`` 为快题（judge.type=none）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.arena.judging import JudgeSpec
from app.arena.types import DimensionId

TemplateCategory = Literal["scored", "quick"]


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
    category: TemplateCategory = "scored"


_NONE = JudgeSpec(type="none")

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
    # ===== 快题（原前端硬编码，现统一后端数据源）=====
    TaskTemplate(
        id="quick_time",
        name="时间",
        description="快题：查询当前时间",
        question="现在几点？",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_calc",
        name="计算",
        description="快题：四则运算",
        question="计算 (128 + 64) * 2 / 8 + 15",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_multi_time",
        name="多步·时间",
        description="快题：时间工具组合",
        question="获取当前时间，并计算距离午夜的分钟数",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_factorial",
        name="多步·阶乘",
        description="快题：代码 + 写文件",
        question="先用代码计算 17 的阶乘，再把结果写入 result.txt",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_files",
        name="文件读写",
        description="快题：工作空间文件操作",
        question="创建 notes.md，写入三条今日待办，再读取并列出工作空间文件",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_code_file",
        name="代码+文件",
        description="快题：写代码并执行",
        question="写一个 hello.py（打印 Hello AgentPrism），用 run_code 执行它，把输出追加到 log.txt",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_primes",
        name="素数统计",
        description="快题：用代码找素数",
        question="用代码找出 1 到 100 中所有素数，并统计个数",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_fibonacci",
        name="斐波那契",
        description="快题：生成数列并写文件",
        question="用代码生成斐波那契数列前 20 项，写入 fib.txt",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_summarize",
        name="文本摘要",
        description="快题：摘要工具",
        question=(
            "将下面文字摘要到 80 字以内：Agent 对比实验需要在相同任务下并行观察框架、"
            "提示词、推理模式与上下文策略的差异，才能量化延迟、Token 与工具调用次数。"
        ),
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_pipeline",
        name="综合编排",
        description="快题：多工具流水线",
        question="获取当前时间 → 计算本小时还剩多少分钟 → 把结论写入 report.md → 再摘要该文件内容",
        category="quick",
        judge=_NONE,
    ),
    TaskTemplate(
        id="quick_plan",
        name="实验规划",
        description="快题：规划类问题",
        question=(
            "规划一个三步实验：对比 LangChain 与 LangGraph 在工具调用上的差异；"
            "每步写清目标、工具与成功标准"
        ),
        category="quick",
        judge=_NONE,
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
