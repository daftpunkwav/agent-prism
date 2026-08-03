"""自动判分器单元测试。"""

from __future__ import annotations

from app.arena.judging import JudgeSpec, judge_answer, judge_answers


def test_keyword_any_of_hits():
    spec = JudgeSpec(type="keyword", any_of=["list", "dict", "set"], min_hits=2)
    r = judge_answer("Python 有 list 和 dict 两种结构", spec)
    assert r.passed is True
    assert r.reason == "关键词命中 2 个"


def test_keyword_min_hits_fail():
    spec = JudgeSpec(type="keyword", any_of=["list", "dict", "set"], min_hits=3)
    r = judge_answer("Python 有 list", spec)
    assert r.passed is False
    assert "命中不足" in r.reason


def test_keyword_all_of_required():
    spec = JudgeSpec(type="keyword", all_of=["递归", "调用"], min_hits=2)
    assert judge_answer("递归就是函数调用自己", spec).passed is True
    assert judge_answer("递归", spec).passed is False


def test_json_valid_with_fields():
    spec = JudgeSpec(type="json", required_fields=["name", "age"])
    r = judge_answer('{"name": "张三", "age": 30}', spec)
    assert r.passed is True


def test_json_missing_field():
    spec = JudgeSpec(type="json", required_fields=["name", "hobbies"])
    r = judge_answer('{"name": "张三"}', spec)
    assert r.passed is False
    assert "hobbies" in r.reason


def test_json_embedded_in_text():
    spec = JudgeSpec(type="json", required_fields=["name"])
    r = judge_answer("结果如下：\n```json\n{\"name\": \"张三\"}\n```", spec)
    assert r.passed is True


def test_json_invalid():
    spec = JudgeSpec(type="json", required_fields=["name"])
    assert judge_answer("这不是 JSON", spec).passed is False


def test_code_syntax_valid():
    spec = JudgeSpec(type="code", must_contain=["def fib"], max_len=6000)
    r = judge_answer('```python\ndef fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n```', spec)
    assert r.passed is True


def test_code_syntax_error():
    spec = JudgeSpec(type="code", must_contain=[], max_len=6000)
    r = judge_answer("def broken(:\n    pass", spec)
    assert r.passed is False
    assert "语法错误" in r.reason


def test_code_missing_keyword():
    spec = JudgeSpec(type="code", must_contain=["def fib"], max_len=6000)
    r = judge_answer("x = 1", spec)
    assert r.passed is False
    assert "fib" in r.reason


def test_code_too_long():
    spec = JudgeSpec(type="code", must_contain=[], max_len=100)
    r = judge_answer("# " + "x" * 200, spec)
    assert r.passed is False
    assert "过长" in r.reason


def test_numeric_equal():
    spec = JudgeSpec(type="numeric", operator="==", value=384, tolerance=0.001)
    assert judge_answer("答案是 384", spec).passed is True
    assert judge_answer("384.0", spec).passed is True


def test_numeric_wrong():
    spec = JudgeSpec(type="numeric", operator="==", value=384, tolerance=0.001)
    r = judge_answer("答案是 383", spec)
    assert r.passed is False
    assert "383" in r.reason


def test_numeric_greater_than():
    spec = JudgeSpec(type="numeric", operator=">=", value=25)
    assert judge_answer("100 以内质数有 25 个", spec).passed is True
    assert judge_answer("只有 20 个", spec).passed is False


def test_numeric_extracts_first_number():
    spec = JudgeSpec(type="numeric", operator="==", value=384)
    # 从 "128 + 64 = 192" 提取第一个数字 128 — 判定失败（合理：答案应直接给结果）
    assert judge_answer("128 + 64 = 192", spec).passed is False


def test_exclude_patterns():
    spec = JudgeSpec(type="exclude", patterns=["无法", "抱歉"])
    assert judge_answer("递归是函数调用自己", spec).passed is True
    r = judge_answer("抱歉，我无法回答", spec)
    assert r.passed is False
    assert "抱歉" in r.reason


def test_regex_match():
    spec = JudgeSpec(type="regex", pattern=r"\d{1,4}\s*(分钟|min)")
    assert judge_answer("距离午夜还有 320 分钟", spec).passed is True
    assert judge_answer("不确定", spec).passed is False


def test_regex_truncates_oversized_answer():
    """超长 answer 应在匹配前截断，避免正则回溯卡顿（ReDoS 防御）。"""
    spec = JudgeSpec(type="regex", pattern=r"\d{1,4}(\.\d+)?\s*(分钟|min)")
    # 10000 字符的纯数字串：截断后快速返回不通过，且不抛异常
    r = judge_answer("9" * 10000, spec)
    assert r.passed is False
    assert "未匹配" in r.reason


def test_empty_answer_fails():
    spec = JudgeSpec(type="keyword", any_of=["a"], min_hits=1)
    assert judge_answer("", spec).passed is False
    assert judge_answer("   ", spec).passed is False


def test_judge_answers_batch():
    spec = JudgeSpec(type="keyword", any_of=["ok"], min_hits=1)
    results = judge_answers({"a": "ok", "b": "no"}, spec)
    assert results["a"].passed is True
    assert results["b"].passed is False
