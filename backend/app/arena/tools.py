"""统一 Tool 集 — 所有框架 Adapter 共用。

Tool 分为两类：
1. 无状态工具（get_current_time, calculate）：无副作用，纯函数
2. 工作空间工具（read_file, write_file 等）：操作 Agent 隔离工作空间
"""

from __future__ import annotations

import ast
from datetime import datetime, timezone

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.arena.workspace import Workspace, WorkspaceManager, get_current_workspace_name

# 全局工作空间管理器（每个 Agent 运行独立创建 workspace）
_workspace_mgr = WorkspaceManager()


def get_workspace_mgr() -> WorkspaceManager:
    return _workspace_mgr


# ===== 无状态工具 =====

@tool
def get_current_time(format: str = "iso") -> str:
    """获取当前 UTC 时间。format 可选: iso（默认）、readable、timestamp。"""
    now = datetime.now(timezone.utc)
    if format == "readable":
        return now.strftime("%Y-%m-%d %H:%M:%S UTC")
    if format == "timestamp":
        return str(int(now.timestamp()))
    return now.isoformat()


def _safe_calculate(expression: str) -> str:
    """计算简单数学表达式，仅支持 + - * / ** // % 和括号。数字仅限阿拉伯数字。"""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return "错误: 表达式语法错误"

    ALLOWED_NODES = (
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant,
        ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.Pow, ast.FloorDiv, ast.Mod, ast.USub, ast.UAdd,
    )
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            return f"错误: 不允许的语法元素: {type(node).__name__}"
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            return "错误: 只能使用数字"

    try:
        result = eval(compile(tree, "<expr>", "eval"), {"__builtins__": {}}, {})
        return str(result)
    except Exception as exc:
        return f"计算错误: {exc}"


@tool
def calculate(expression: str) -> str:
    """计算简单数学表达式，仅支持 + - * / ** // % 和括号。"""
    return _safe_calculate(expression)


# ===== 工作空间工具 =====

class _WriteFileInput(BaseModel):
    path: str = Field(description="文件路径，如 main.py、src/utils.py")
    content: str = Field(description="文件完整内容")


class _AppendFileInput(BaseModel):
    path: str = Field(description="要追加的文件路径")
    content: str = Field(description="要追加的内容")


class _CreateFileInput(BaseModel):
    path: str = Field(description="新文件路径")
    content: str = Field(default="", description="初始内容（可选）")


@tool(args_schema=_WriteFileInput)
def write_file(path: str, content: str) -> str:
    """在工作空间中写入文件（覆盖已有文件）。适用于创建完整文件。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.write_file(path, content)


@tool(args_schema=_AppendFileInput)
def append_file(path: str, content: str) -> str:
    """向已有文件追加内容。适用于增量修改。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.append_file(path, content)


@tool(args_schema=_CreateFileInput)
def create_file(path: str, content: str = "") -> str:
    """在工作空间中创建新文件（如果已存在则报错）。安全地创建，避免覆盖。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.create_file(path, content)


@tool
def read_file(path: str) -> str:
    """读取工作空间中的文件内容。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.read_file(path)


@tool
def list_files(dir_path: str = "") -> str:
    """列出工作空间目录中的文件。不填参数列出根目录。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    files = ws.list_files(dir_path)
    if not files:
        return f"(目录为空: {dir_path or '根目录'})"
    return "\n".join(f"  📄 {f}" for f in files)


@tool
def file_tree() -> str:
    """显示工作空间完整文件树及每文件字节数。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.file_tree()


@tool
def delete_file(path: str) -> str:
    """删除工作空间中的文件。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.delete_file(path)


# ===== 代码执行工具 =====

class _RunCodeInput(BaseModel):
    code: str = Field(description="要执行的 Python 代码")
    timeout: int = Field(default=5, description="超时秒数（最大 10）")


def _safe_run_code(code: str, timeout: int = 5) -> str:
    """在工作空间中执行 Python 代码并返回输出。沙箱限制：无网络/文件系统/子进程/反射。"""
    import io
    import sys
    import traceback as tb_mod

    timeout = min(timeout, 10)
    captured = io.StringIO()
    # 重定向到独立 StringIO，不污染全局 sys.stdout，
    # 避免并发请求间 stdout 互相覆盖。
    safe_ns = {
        "__builtins__": {
            "print": lambda *a, **k: captured.write(" ".join(str(x) for x in a) + "\n"),
            "len": len, "range": range,
            "str": str, "int": int, "float": float, "bool": bool,
            "list": list, "dict": dict, "set": set, "tuple": tuple,
            "sum": sum, "min": min, "max": max, "abs": abs,
            "round": round, "sorted": sorted, "enumerate": enumerate,
            "zip": zip, "map": map, "filter": filter,
            "all": all, "any": any,
            "True": True, "False": False, "None": None,
            "isinstance": isinstance, "type": type,
            "Exception": Exception, "ValueError": ValueError,
            "TypeError": TypeError, "KeyError": KeyError,
            "IndexError": IndexError, "AttributeError": AttributeError,
        }
    }
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = captured, captured
    try:
        compiled = compile(code, "<run_code>", "exec")
        exec(compiled, safe_ns, safe_ns)
        output = captured.getvalue()
        return output if output else "(代码执行成功，无输出)"
    except Exception:
        return f"执行错误:\n{tb_mod.format_exc()}"
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr


@tool(args_schema=_RunCodeInput)
def run_code(code: str, timeout: int = 5) -> str:
    """在工作空间中执行 Python 代码并返回输出。沙箱限制：无网络/文件系统/子进程/反射。"""
    return _safe_run_code(code, min(timeout, 10))


# ===== 文本摘要工具 =====

@tool
def summarize_text(text: str, max_length: int = 200) -> str:
    """简单文本摘要：截断到指定长度并标记。适用于上下文压缩。"""
    if len(text) <= max_length:
        return text
    # 尝试在句号/换行处截断
    truncated = text[:max_length]
    last_period = max(truncated.rfind("。"), truncated.rfind("\n"), truncated.rfind(". "))
    if last_period > max_length * 0.6:
        return text[: last_period + 1] + f"\n\n...[已截断，原长 {len(text)} 字符]"
    return text[:max_length] + f"...[已截断，原长 {len(text)} 字符]"


def _get_ws() -> Workspace | None:
    """获取当前 Agent 运行的工作空间（通过线程本地变量）。"""
    name = get_current_workspace_name()
    if name:
        return _workspace_mgr.get(name)
    return None


# ===== 导出 =====

ARENA_TOOLS = [
    # 基础工具
    get_current_time,
    calculate,
    # 工作空间工具
    write_file,
    append_file,
    create_file,
    read_file,
    list_files,
    file_tree,
    delete_file,
    # 代码执行
    run_code,
    # 文本摘要
    summarize_text,
]
