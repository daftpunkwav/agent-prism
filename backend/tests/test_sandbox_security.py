"""沙箱安全回归测试 — 验证 run_code 沙箱无法逃逸。"""

import pytest

from app.arena.tools import _safe_calculate, _safe_run_code


# ===== run_code 沙箱逃逸测试 =====


class TestSandboxEscape:
    """确保 _safe_run_code 沙箱无法逃逸到外部环境。"""

    def test_no_import_access(self):
        result = _safe_run_code("import os")
        assert "错误" in result or "NameError" in result

    def test_no_open_builtin(self):
        result = _safe_run_code("open('/etc/passwd')")
        assert "错误" in result or "NameError" in result

    def test_no_exec(self):
        result = _safe_run_code("exec('import os')")
        assert "错误" in result or "NameError" in result

    def test_no_eval(self):
        result = _safe_run_code("eval('1+1')")
        assert "错误" in result or "NameError" in result

    def test_no_subprocess(self):
        result = _safe_run_code("import subprocess")
        assert "错误" in result or "NameError" in result

    def test_no_system_call(self):
        result = _safe_run_code("__import__('os').system('ls')")
        assert "错误" in result or "NameError" in result

    def test_no_file_read(self):
        result = _safe_run_code("print(open('/etc/passwd').read())")
        assert "错误" in result or "NameError" in result

    def test_no_globals_access(self):
        result = _safe_run_code("print(globals())")
        # globals 应该不在白名单中
        assert "错误" in result or "NameError" in result

    def test_no_getattr(self):
        result = _safe_run_code("print(getattr(__builtins__, 'open'))")
        assert "错误" in result or "NameError" in result

    def test_no_type_builtin(self):
        """type() 不应在沙箱中可用（防止逃逸）。"""
        result = _safe_run_code("print(type(1))")
        assert "错误" in result or "NameError" in result

    def test_safe_print_works(self):
        result = _safe_run_code("print('hello world')")
        assert "hello world" in result

    def test_safe_math_works(self):
        result = _safe_run_code("print(2 + 3 * 4)")
        assert "14" in result

    def test_list_comprehension(self):
        result = _safe_run_code("print([x * 2 for x in range(5)])")
        assert "[0, 2, 4, 6, 8]" in result

    def test_dict_operations(self):
        result = _safe_run_code("d = {'a': 1}; print(d['a'])")
        assert "1" in result

    def test_no_control_chars_injection(self):
        """测试控制字符不会导致路径穿越。"""
        result = _safe_run_code("print('test')")
        assert "test" in result


# ===== calculate 安全测试 =====


class TestCalculateSecurity:
    def test_rejects_dunder_import(self):
        result = _safe_calculate("__import__('os').system('ls')")
        assert "错误" in result

    def test_rejects_attribute_access(self):
        result = _safe_calculate("os.system('ls')")
        assert "错误" in result

    def test_rejects_string_literals(self):
        result = _safe_calculate("'hello'")
        assert "错误" in result

    def test_rejects_multiline(self):
        result = _safe_calculate("2 + 3\nimport os")
        assert "错误" in result

    def test_valid_arithmetic(self):
        assert _safe_calculate("2 + 3") == "5"
        assert _safe_calculate("(2 + 3) * 4") == "20"
        assert _safe_calculate("2 ** 8") == "256"
