"""工具安全的单元测试。"""

from app.arena.tools import _safe_calculate, _safe_run_code

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


# ===== run_code 沙箱逃逸回归测试 =====


def test_run_code_blocks_type_reflection():
    """``type()`` 不在白名单中 — 无法通过 ``().__class__.__base__.__subclasses__()`` 链逃逸。"""
    result = _safe_run_code("print(type(()).__bases__)")
    # 应当 NameError / 错误（type 不可见），绝不能输出 "(object,)"
    assert "(object,)" not in result
    assert "错误" in result or "NameError" in result or "输出" in result


def test_run_code_blocks_mro_walk():
    """尝试通过 ().__class__.__mro__ 找到 os._wrap_close 失败。"""
    payload = "print(().__class__.__mro__[1].__subclasses__())"
    result = _safe_run_code(payload)
    assert "<class 'object'>" not in result
    assert "os._wrap_close" not in result


def test_run_code_blocks_os_import_via_metaclass():
    """典型 metaclass 逃逸：type(name, bases, dict) — type 已被移除。"""
    payload = "X = type('X', (object,), {}); print(X)"
    result = _safe_run_code(payload)
    assert "<class" not in result or "错误" in result or "NameError" in result


def test_run_code_blocks_builtins_dir():
    """``__builtins__`` 被设为受限字典 — ``dir(__builtins__)`` 不能列出 ``eval``/``exec``/``open``。"""
    result = _safe_run_code("print('eval' in dir(__builtins__))")
    assert "True" not in result


def test_run_code_true_false_none_not_typed():
    """True/False/None 不再注入为裸名 — 仅作为字面量出现在 AST 中。"""
    # 这是合法的字面量；只校验 print 函数能输出它们
    result = _safe_run_code("print(True, False, None)")
    assert "True" in result and "False" in result


def test_run_code_timeout_enforced():
    """真正超时应当被强制终止（multiprocessing.terminate）。"""
    # 死循环 + 2s 超时 — 沙箱不接受 sleep（无 time 模块），所以用纯计算阻塞
    code = "x = 0\nwhile True: x += 1"
    result = _safe_run_code(code, timeout=2)
    assert "超时" in result or "强制终止" in result


def test_run_code_rejects_oversized_input():
    result = _safe_run_code("x = '" + "a" * (20 * 1024) + "'")
    assert "过长" in result


def test_run_code_blocks_getattr():
    """``getattr`` 是反射链的标准绕过入口，必须静态拦截。"""
    result = _safe_run_code("print(getattr((), '__class__'))")
    assert "禁止" in result or "错误" in result


def test_run_code_blocks_dunder_attribute():
    """直接通过 ``().__class__`` 也必须拦截（不依赖 getattr）。"""
    result = _safe_run_code("print(().__class__)")
    assert "禁止" in result or "错误" in result


def test_run_code_blocks_dunder_subclasses():
    result = _safe_run_code("print(().__class__.__bases__[0].__subclasses__())")
    assert "禁止" in result or "错误" in result


def test_calculate_rejects_oversized_expression():
    assert "过长" in _safe_calculate("1+" * 500)
    assert "过长" in _safe_calculate("x" * 600)


def test_calculate_does_not_leak_exception_text():
    """计算错误不再把 exc.args 回显给 LLM。"""
    # 通过构造不可达的 AST 让 eval 抛 ZeroDivisionError 但调用 None.method 触发 AttributeError
    result = _safe_calculate("1/0")
    # 应返回通用消息，绝不暴露 Python 内部细节如 "division by zero"
    assert "division" not in result.lower()
    assert "错误" in result


def test_calculate_rejects_non_string():
    assert "字符串" in _safe_calculate(123)  # type: ignore[arg-type]
    assert "字符串" in _safe_calculate(None)  # type: ignore[arg-type]


def test_calculate_rejects_huge_power():
    """防 CPU DoS：大指数幂运算必须在 AST 层拦截。"""
    assert "过大" in _safe_calculate("2 ** 300000000")
    assert "过大" in _safe_calculate("9 ** 999999999")


def test_calculate_rejects_huge_constant():
    """超大数值常量同样拦截。"""
    assert "过大" in _safe_calculate("10" * 30)
    assert "过大" in _safe_calculate("99999999999999999999")


def test_calculate_allows_reasonable_power():
    """正常幂运算不受影响。"""
    assert _safe_calculate("2 ** 8") == "256"
    assert _safe_calculate("2 ** 1000").startswith("10715086")


def test_run_code_large_output_truncated_not_timed_out():
    """超大输出应在子进程端截断，而不是误报"执行超时"。"""
    result = _safe_run_code("print('x' * 200000)", timeout=5)
    assert "超时" not in result
    assert "截断" in result
    assert len(result) < 70 * 1024


# ===== 工作空间路径校验增强 =====


def test_workspace_rejects_null_byte():
    import pytest

    from app.arena.workspace import Workspace, WorkspaceError

    ws = Workspace(name="t")
    # 空字节会被 os.path.normpath 静默剥离，必须显式拒绝
    with pytest.raises(WorkspaceError):
        ws.write_file("foo\x00.txt", "x")
    with pytest.raises(WorkspaceError):
        ws.write_file("bar\x07.py", "x")


def test_tool_uses_workspace_override():
    """注入独立 WorkspaceManager 后，工具函数必须读写该实例而非全局单例。

    注：直接调用 ``write_file.func``（StructuredTool 的原始函数）而非
    ``.invoke()`` — invoke 经线程池执行，contextvars 不跨线程传播；
    真实 pipeline 中工具在异步任务栈内调用，ContextVar 正常继承。
    """
    from app.arena.tools import (
        get_workspace_mgr,
        read_file,
        set_workspace_mgr_override,
        write_file,
    )
    from app.arena.workspace import (
        WorkspaceManager,
        clear_current_workspace,
        set_current_workspace,
    )

    iso = WorkspaceManager()
    set_workspace_mgr_override(iso)
    # 与真实 pipeline 一致：先在工作空间管理器创建实例，再设置当前工作空间名
    iso.create("ovr_ws")
    set_current_workspace("ovr_ws")
    try:
        assert get_workspace_mgr() is iso
        assert write_file.func(path="a.txt", content="v1").startswith("已写入")
        # 写入落在注入实例；全局单例中不应存在
        assert iso.get("ovr_ws") is not None
        assert iso.get("ovr_ws").read_file("a.txt") == "v1"
        assert read_file.func(path="a.txt") == "v1"
    finally:
        set_workspace_mgr_override(None)
        clear_current_workspace()
