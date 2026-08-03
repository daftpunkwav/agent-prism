"""自动判分器 — 任务模板的 L1 格式/约束验证（无需 LLM）。

判分类型（``JudgeSpec.type``）：
- ``keyword``: 答案须命中指定关键词（any_of / all_of / min_hits）
- ``json``: 答案可解析为 JSON，且满足 required_fields / field_types
- ``code``: 提取 Python 代码块（或全文），AST 语法校验 + 可选 must_contain
- ``numeric``: 从答案提取数字并按 operator/value/tolerance 比较
- ``exclude``: 答案不得包含指定模式（如"无法回答"）
- ``regex``: 答案匹配正则

设计原则：所有判分器都是纯函数、确定性、可测试；不做语义判断
（语义验证属于 Harness verify 的 L3 层，由 LLM 完成）。
"""

from __future__ import annotations

import ast
import json
import re
from typing import Literal

from pydantic import BaseModel, Field

# 判分类型
JudgeType = Literal["keyword", "json", "code", "numeric", "exclude", "regex", "none"]

# 提取 Python 代码块：```python ... ``` 或 ``` ... ```
_CODE_FENCE = re.compile(r"```(?:python|py)?\s*\n(.*?)\n?\s*```", re.DOTALL)


class JudgeSpec(BaseModel):
    """模板判分规则。"""

    type: JudgeType
    # keyword
    any_of: list[str] = Field(default_factory=list)
    all_of: list[str] = Field(default_factory=list)
    min_hits: int = Field(default=1, ge=1)
    # json
    required_fields: list[str] = Field(default_factory=list)
    # code
    must_contain: list[str] = Field(default_factory=list)
    max_len: int = Field(default=8000, ge=1)
    # numeric
    operator: Literal["==", ">=", "<=", ">", "<"] = "=="
    value: float = 0.0
    tolerance: float = Field(default=0.0, ge=0.0)
    # exclude / regex
    patterns: list[str] = Field(default_factory=list)
    pattern: str = ""


class JudgeResult(BaseModel):
    """单条答案的判分结果。"""

    passed: bool
    reason: str
    details: list[str] = Field(default_factory=list)


def _extract_numbers(text: str) -> list[float]:
    """提取文本中所有数字（整数/小数，支持千分位与负号）。"""
    return [float(m) for m in re.findall(r"-?\d+(?:,\d{3})*(?:\.\d+)?", text.replace(",", ""))]


def _extract_code(text: str) -> str:
    """优先提取 fenced 代码块；无 fence 时返回全文（去掉可能的 md 标记）。"""
    m = _CODE_FENCE.search(text)
    if m:
        return m.group(1).strip()
    return text.strip()


def _check_numeric(answer: str, spec: JudgeSpec) -> JudgeResult:
    nums = _extract_numbers(answer)
    if not nums:
        return JudgeResult(
            passed=False,
            reason="答案中未提取到数字",
            details=[f"期望 {spec.operator} {spec.value}"],
        )
    got = nums[0]
    target = spec.value
    if spec.operator == "==":
        ok = abs(got - target) <= spec.tolerance
    elif spec.operator == ">=":
        ok = got >= target
    elif spec.operator == "<=":
        ok = got <= target
    elif spec.operator == ">":
        ok = got > target
    else:
        ok = got < target
    return JudgeResult(
        passed=ok,
        reason="数字比较通过" if ok else f"数字比较失败: {got} {spec.operator} {target}",
        details=[f"提取数字: {got}", f"期望: {spec.operator} {target}"],
    )


def _check_json(answer: str, spec: JudgeSpec) -> JudgeResult:
    # 尝试直接解析；失败则提取第一个 {...} 或 [...] 块
    candidates = [answer.strip()]
    brace = re.search(r"[{\[].*[}\]]", answer, re.DOTALL)
    if brace:
        candidates.append(brace.group(0))
    for cand in candidates:
        try:
            data = json.loads(cand)
            break
        except (json.JSONDecodeError, ValueError):
            continue
    else:
        return JudgeResult(passed=False, reason="答案不是合法 JSON", details=["JSON 解析失败"])
    if not isinstance(data, dict):
        return JudgeResult(passed=False, reason="JSON 顶层应为对象", details=[f"实际类型: {type(data).__name__}"])
    missing = [f for f in spec.required_fields if f not in data]
    if missing:
        return JudgeResult(passed=False, reason=f"缺少字段: {', '.join(missing)}", details=missing)
    return JudgeResult(passed=True, reason="JSON 解析与字段校验通过", details=list(data.keys()))


def _check_code(answer: str, spec: JudgeSpec) -> JudgeResult:
    code = _extract_code(answer)
    if len(code) > spec.max_len:
        return JudgeResult(passed=False, reason=f"代码过长（{len(code)} > {spec.max_len}）", details=["长度超限"])
    missing = [kw for kw in spec.must_contain if kw not in code]
    if missing:
        return JudgeResult(passed=False, reason=f"缺少关键字: {', '.join(missing)}", details=missing)
    try:
        ast.parse(code)
    except SyntaxError as exc:
        return JudgeResult(
            passed=False,
            reason=f"Python 语法错误: {exc.msg}",
            details=[f"行 {exc.lineno}"],
        )
    return JudgeResult(passed=True, reason="Python 语法校验通过", details=[f"{len(code)} 字符"])


def _check_keyword(answer: str, spec: JudgeSpec) -> JudgeResult:
    hits: list[str] = []
    for kw in spec.any_of:
        if kw in answer:
            hits.append(kw)
    for kw in spec.all_of:
        if kw in answer:
            hits.append(kw)
        else:
            return JudgeResult(passed=False, reason=f"缺少关键词: {kw}", details=[f"需包含: {kw}"])
    if len(hits) < spec.min_hits:
        return JudgeResult(
            passed=False,
            reason=f"关键词命中不足（{len(hits)}/{spec.min_hits}）",
            details=[f"命中的关键词: {hits or '无'}"],
        )
    return JudgeResult(passed=True, reason=f"关键词命中 {len(hits)} 个", details=hits)


def _check_exclude(answer: str, spec: JudgeSpec) -> JudgeResult:
    found = [p for p in spec.patterns if p in answer]
    if found:
        return JudgeResult(passed=False, reason=f"答案包含禁用模式: {', '.join(found)}", details=found)
    return JudgeResult(passed=True, reason="未包含禁用模式", details=[])


def _check_regex(answer: str, spec: JudgeSpec) -> JudgeResult:
    if not spec.pattern:
        return JudgeResult(passed=False, reason="未配置正则", details=[])
    # 防御 ReDoS：截断超长输入（预置模板最长匹配不超过 100 字符）
    safe_answer = answer[:2000]
    try:
        ok = re.search(spec.pattern, safe_answer) is not None
    except re.error as exc:
        return JudgeResult(passed=False, reason=f"正则无效: {exc}", details=[])
    return JudgeResult(
        passed=ok,
        reason="正则匹配通过" if ok else "正则未匹配",
        details=[spec.pattern],
    )


def judge_answer(answer: str, spec: JudgeSpec) -> JudgeResult:
    """按 JudgeSpec 判分单条答案。空答案直接失败（``none`` 类型除外）。"""
    if spec.type == "none":
        return JudgeResult(passed=True, reason="该模板不支持自动判分", details=[])
    if not answer or not answer.strip():
        return JudgeResult(passed=False, reason="答案为空", details=[])
    if spec.type == "keyword":
        return _check_keyword(answer, spec)
    if spec.type == "json":
        return _check_json(answer, spec)
    if spec.type == "code":
        return _check_code(answer, spec)
    if spec.type == "numeric":
        return _check_numeric(answer, spec)
    if spec.type == "exclude":
        return _check_exclude(answer, spec)
    if spec.type == "regex":
        return _check_regex(answer, spec)
    return JudgeResult(passed=False, reason=f"未知判分类型: {spec.type}", details=[])


def judge_answers(answers: dict[str, str], spec: JudgeSpec) -> dict[str, JudgeResult]:
    """批量判分：{label: answer} → {label: JudgeResult}。"""
    return {label: judge_answer(text, spec) for label, text in answers.items()}