"""工具安全的单元测试。"""

import pytest

from app.arena.tools import _safe_calculate, _safe_run_code, calculate, run_code


# ===== calculate 安全测试 =====

def test_calculate_basic_arithmetic():
    assert _safe_calculate("2 + 3") == "5"
    assert _safe_calculate("10 - 4") == "6"
    assert _safe_calculate("3 * 7") == "21"
    assert _safe_calculate("100 / 4") == "25.0"


def test_calculate_with_parentheses():
    assert _safe_calculate("(2 + 3) * 4") == "20"
    assert _safe_calculate("2 * (3 + 4)") == "14"


def test_calculate_power_and_mod():
    assert _safe_calculate("2 ** 8") == "256"
    assert _safe_calculate("10 % 3") == "1"
    assert _safe_calculate("10 // 3") == "3"


def test_calculate_negative():
    assert _safe_calculate("-5 + 3") == "-2"
    assert _safe_calculate("-(2 + 3)") == "-5"


def test_calculate_rejects_function_calls():
    result = _safe_calculate("__import__('os').system('ls')")
    assert "不安全" in result or "不允许" in result or "错误" in result


def test_calculate_rejects_variable_names():
    result = _safe_calculate("os.system('ls')")
    assert "不安全" in result or "不允许" in result or "错误" in result


def test_calculate_rejects_strings():
    result = _safe_calculate("'hello'")
    assert "不安全" in result or "不允许" in result or "错误" in result


def test_calculate_rejects_multiline():
    result = _safe_calculate("2 + 3\nimport os")
    assert "不安全" in result or "不允许" in result or "错误" in result


# ===== run_code 安全测试 =====

def test_run_code_basic_print():
    result = _safe_run_code("print('hello')")
    assert "hello" in result


def test_run_code_math():
    result = _safe_run_code("print(2 + 3 * 4)")
    assert "14" in result


def test_run_code_rejects_import():
    result = _safe_run_code("import os")
    assert "错误" in result or "NameError" in result


def test_run_code_rejects_open():
    result = _safe_run_code("open('/etc/passwd')")
    assert "错误" in result or "NameError" in result


def test_run_code_rejects_exec():
    result = _safe_run_code("exec('import os')")
    assert "错误" in result or "NameError" in result


def test_run_code_rejects_subprocess():
    result = _safe_run_code("import subprocess")
    assert "错误" in result or "NameError" in result


def test_run_code_no_file_access():
    result = _safe_run_code("print(open('/etc/passwd').read())")
    assert "错误" in result or "NameError" in result
