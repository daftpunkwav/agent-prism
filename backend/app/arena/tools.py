"""统一 Tool 集 — 所有框架 Adapter 共用。

Tool 分为两类：
1. 无状态工具（get_current_time, calculate）：无副作用，纯函数
2. 工作空间工具（read_file, write_file 等）：操作 Agent 隔离工作空间
"""

from __future__ import annotations

import ast
import io
import logging
import multiprocessing as mp
import sys
import threading
from datetime import datetime, timezone
from typing import Any

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.arena.workspace import Workspace, WorkspaceManager, get_current_workspace_name

logger = logging.getLogger(__name__)

# 限制同时运行的沙箱子进程数，防止资源耗尽
_RUN_CODE_SEM = threading.Semaphore(4)
# 子进程 join 后额外等待 terminate/kill 的秒数
_PROCESS_KILL_GRACE = 1.0

# 全局工作空间管理器（每个 Agent 运行独立创建 workspace）
_workspace_mgr = WorkspaceManager()


def get_workspace_mgr() -> WorkspaceManager:
    return _workspace_mgr


# ===== 无状态工具 =====


@tool
def get_current_time(time_format: str = "iso") -> str:
    """获取当前 UTC 时间。time_format 可选: iso（默认）、readable、timestamp。"""
    now = datetime.now(timezone.utc)
    if time_format == "readable":
        return now.strftime("%Y-%m-%d %H:%M:%S UTC")
    if time_format == "timestamp":
        return str(int(now.timestamp()))
    return now.isoformat()


def _safe_calculate(expression: str) -> str:
    """计算简单数学表达式，仅支持 + - * / ** // % 和括号。数字仅限阿拉伯数字。"""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return "错误: 表达式语法错误"

    ALLOWED_NODES = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Constant,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.FloorDiv,
        ast.Mod,
        ast.USub,
        ast.UAdd,
    )
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            return "错误: 不允许的语法元素"
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            return "错误: 只能使用数字"

    try:
        result = eval(compile(tree, "<expr>", "eval"), {"__builtins__": {}}, {})
        return str(result)
    except Exception:
        return "计算错误: 表达式无法求值"


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


def _make_safe_builtins() -> dict[str, Any]:
    """构造沙箱允许的安全内置函数白名单（在子进程内重建，避免 pickle 问题）。"""
    return {
        "print": lambda *args, sep=" ", end="\n", file=None, flush=False: sys.stdout.write(  # type: ignore[no-any-return]
            sep.join(str(a) for a in args) + end
        ),
        "len": len,
        "range": range,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "list": list,
        "dict": dict,
        "set": set,
        "tuple": tuple,
        "sum": sum,
        "min": min,
        "max": max,
        "abs": abs,
        "round": round,
        "sorted": sorted,
        "enumerate": enumerate,
        "zip": zip,
        "map": map,
        "filter": filter,
        "all": all,
        "any": any,
        "isinstance": isinstance,
    }


# 兼容旧测试/调用方：模块级白名单（与子进程内一致）
_SAFE_BUILTINS: dict[str, Any] = _make_safe_builtins()


def _ast_security_check(code: str) -> str | None:
    """静态检查代码 AST，拒绝 dunder 属性访问等逃逸路径。返回错误信息或 None。"""
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError:
        return "执行错误: 语法错误"

    for node in ast.walk(tree):
        # 禁止 __class__ / __subclasses__ / __globals__ 等反射逃逸
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return f"错误: 不允许访问属性 «{node.attr}»"
        # 禁止 import / from import
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return "错误: 不允许 import"
        # 禁止动态 import 常见调用名（即便出现在字符串调用中）
        if isinstance(node, ast.Name) and node.id in {
            "__import__",
            "getattr",
            "setattr",
            "delattr",
            "globals",
            "locals",
            "vars",
            "eval",
            "exec",
            "compile",
            "open",
            "breakpoint",
            "help",
            "input",
            "memoryview",
            "bytearray",
            "bytes",
            "object",
            "super",
            "classmethod",
            "staticmethod",
            "property",
            "type",
        }:
            return f"错误: 不允许使用 «{node.id}»"
    return None


def _execute_in_namespace(code: str, safe_ns: dict[str, Any], captured: io.StringIO) -> str | None:
    """在安全命名空间中执行代码。返回错误信息，成功则返回 None。"""
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = captured, captured
    try:
        compiled = compile(code, "<run_code>", "exec")
        exec(compiled, safe_ns, safe_ns)
        return None
    except SyntaxError:
        return "执行错误: 语法错误"
    except NameError as exc:
        return f"执行错误: {exc}"
    except TypeError as exc:
        return f"执行错误: {exc}"
    except ValueError as exc:
        return f"执行错误: {exc}"
    except Exception as exc:  # noqa: BLE001
        return f"执行错误: {type(exc).__name__}"
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr


def _sandbox_worker(code: str, result_queue: Any) -> None:
    """子进程入口：执行受限代码并把结果放入队列。

    必须为模块顶层函数，以便 Windows spawn 模式可 pickle。
    """
    try:
        captured = io.StringIO()
        safe_ns: dict[str, Any] = {"__builtins__": _make_safe_builtins()}
        err = _execute_in_namespace(code, safe_ns, captured)
        if err:
            result_queue.put(("error", err))
        else:
            output = captured.getvalue()
            result_queue.put(("ok", output if output else "(代码执行成功，无输出)"))
    except Exception as exc:  # noqa: BLE001
        try:
            result_queue.put(("error", f"执行错误: {type(exc).__name__}"))
        except Exception:  # noqa: BLE001
            pass


def _terminate_process(proc: mp.Process) -> None:
    """尽量强制终止子进程：terminate → join → kill。"""
    if not proc.is_alive():
        return
    try:
        proc.terminate()
    except Exception:  # noqa: BLE001
        logger.debug("terminate 子进程失败", exc_info=True)
    proc.join(timeout=_PROCESS_KILL_GRACE)
    if proc.is_alive():
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            logger.debug("kill 子进程失败", exc_info=True)
        proc.join(timeout=_PROCESS_KILL_GRACE)


def _safe_run_code(code: str, timeout: int = 5) -> str:
    """在独立进程中执行 Python 代码并返回输出。

    沙箱限制：无网络/文件系统/子进程/反射；超时后 terminate/kill 子进程。
    """
    timeout = min(max(int(timeout), 1), 10)

    # 先做 AST 静态校验，阻断常见逃逸（无需启动子进程）
    security_err = _ast_security_check(code)
    if security_err:
        return security_err

    acquired = _RUN_CODE_SEM.acquire(timeout=timeout + 2)
    if not acquired:
        return "错误: 沙箱繁忙，请稍后重试"

    ctx = mp.get_context("spawn")
    result_queue: mp.Queue = ctx.Queue(maxsize=1)
    proc = ctx.Process(target=_sandbox_worker, args=(code, result_queue), daemon=True)
    try:
        proc.start()
        proc.join(timeout=timeout)

        if proc.is_alive():
            _terminate_process(proc)
            return "错误: 代码执行超时（进程已终止）"

        # 子进程已退出：读取结果
        try:
            # 短超时避免队列永久阻塞
            status, payload = result_queue.get(timeout=0.5)
        except Exception:  # noqa: BLE001
            exitcode = proc.exitcode
            if exitcode not in (0, None):
                return f"错误: 子进程异常退出 (code={exitcode})"
            return "错误: 未收到执行结果"

        if status == "ok":
            return str(payload)
        return str(payload)
    finally:
        # 清理队列底层资源
        try:
            result_queue.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if proc.is_alive():
                _terminate_process(proc)
        finally:
            _RUN_CODE_SEM.release()


@tool(args_schema=_RunCodeInput)
def run_code(code: str, timeout: int = 5) -> str:
    """在独立进程沙箱中执行 Python 代码并返回输出。超时将强制终止进程。"""
    return _safe_run_code(code, min(timeout, 10))


# ===== 文本摘要工具 =====


@tool
def summarize_text(text: str, max_length: int = 200) -> str:
    """简单文本摘要：截断到指定长度并标记。适用于上下文压缩。"""
    if len(text) <= max_length:
        return text
    truncated = text[:max_length]
    last_period = max(truncated.rfind("。"), truncated.rfind("\n"), truncated.rfind(". "))
    if last_period > max_length * 0.6:
        return text[: last_period + 1] + f"\n\n...[已截断，原长 {len(text)} 字符]"
    return text[:max_length] + f"...[已截断，原长 {len(text)} 字符]"


def _get_ws() -> Workspace | None:
    """获取当前 Agent 运行的工作空间（通过 contextvars.ContextVar）。"""
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
