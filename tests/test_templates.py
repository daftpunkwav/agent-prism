"""任务模板库单元测试。"""

from __future__ import annotations

from app.arena.judging import judge_answer
from app.arena.templates import get_template, list_templates, template_payloads


def test_templates_loaded():
    templates = list_templates()
    assert len(templates) >= 6
    ids = [t.id for t in templates]
    assert len(ids) == len(set(ids)), "模板 id 必须唯一"


def test_every_template_has_judge():
    """所有模板必须自带可执行的判分规则。"""
    for t in list_templates():
        assert t.judge.type in ("keyword", "json", "code", "numeric", "exclude", "regex")
        assert t.question.strip()


def test_get_template_by_id():
    t = get_template("json_profile")
    assert t is not None
    assert t.judge.type == "json"
    assert get_template("不存在的id") is None


def test_template_payloads_serializable():
    payloads = template_payloads()
    for p in payloads:
        assert "id" in p
        assert "judge" in p
        assert "question" in p


def test_json_profile_template_judges_correctly():
    t = get_template("json_profile")
    assert t is not None
    good = judge_answer('{"name": "a", "age": 1, "hobbies": ["x"]}', t.judge)
    assert good.passed is True
    bad = judge_answer('{"name": "a"}', t.judge)
    assert bad.passed is False


def test_arithmetic_template_numeric():
    t = get_template("arithmetic_mix")
    assert t is not None
    assert judge_answer("384", t.judge).passed is True
    assert judge_answer("结果是 192", t.judge).passed is False


def test_prime_count_template():
    t = get_template("prime_count")
    assert t is not None
    assert judge_answer("25", t.judge).passed is True


def test_fibonacci_code_template():
    t = get_template("fibonacci_code")
    assert t is not None
    ok = judge_answer("def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a", t.judge)
    assert ok.passed is True
    assert judge_answer("def not_fib(): pass", t.judge).passed is False


def test_no_refusal_template():
    t = get_template("no_refusal")
    assert t is not None
    assert judge_answer("递归是函数自己调用自己。", t.judge).passed is True
    assert judge_answer("抱歉，我无法回答这个问题。", t.judge).passed is False
