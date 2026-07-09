"""统一 Tool 集 — 所有框架 Adapter 共用。

Tool 分为两类：
1. 无状态工具（get_current_time, calculate）：无副作用，纯函数
2. 工作空间工具（read_file, write_file 等）：操作 Agent 隔离工作空间

安全说明：
- ``calculate`` 仅做 AST 白名单 + 编译后计算，无内置函数可访问。
- ``run_code`` 使用 ``multiprocessing.Process`` 真超时强制；内置白名单
  只保留纯函数（不暴露 ``type``/``Exception``/``isinstance``/``True``/``False``/``None``），
  切断 ``().__class__.__base__.__subclasses__()`` 反射链。
- 文件工具均经 ``Workspace._normalize`` 拒绝向上遍历与控制字符。
"""

from __future__ import annotations

import ast
import contextlib
import io
import logging
import multiprocessing as _mp
import sys
from datetime import datetime, timezone

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.arena.workspace import Workspace, WorkspaceManager, get_current_workspace_name

logger = logging.getLogger(__name__)

# 单文件/单次工具调用的内容上限，避免 LLM 把 10MB 文本写回导致 SSE 卡顿
_MAX_FILE_CONTENT_BYTES = 256 * 1024

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
    if not isinstance(expression, str):
        return "错误: 表达式必须是字符串"
    if len(expression) > 512:
        return "错误: 表达式过长"

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
            return f"错误: 不允许的语法元素: {type(node).__name__}"
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            return "错误: 只能使用数字"

    try:
        # 显式空 __builtins__；空 globals 防止引用外部变量
        result = eval(  # noqa: S307 — 已 AST 白名单
            compile(tree, "<expr>", "eval"),
            {"__builtins__": {}},
            {},
        )
        return str(result)
    except Exception:
        # 不把内部异常文本回显给 LLM（避免泄漏路径/内部细节）
        logger.exception("calculate 失败: %s", expression[:200])
        return "错误: 计算失败"


# ===== run_code 沙箱 AST 校验 =====

# 严禁出现的 dunder 属性名 — 切断 ``().__class__.__mro__[-1].__subclasses__()``
# 等反射链。注意：不区分大小写（Python 属性访问是大小写敏感的，但攻击者
# 仍可通过 ``getattr(obj, "__class__")`` 绕过；因此 AST 黑名单 + getattr 检查双管齐下）。
_FORBIDDEN_DUNDERS: frozenset[str] = frozenset({
    "__class__",
    "__bases__",
    "__mro__",
    "__subclasses__",
    "__globals__",
    "__builtins__",
    "__import__",
    "__getattribute__",
    "__dict__",
    "__init_subclass__",
    "__subclasshook__",
})


def _validate_run_code_ast(tree: ast.AST) -> str | None:
    """静态校验 run_code AST。返回 None 表示通过；返回错误消息表示拒绝。"""
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            if node.attr in _FORBIDDEN_DUNDERS:
                return f"错误: 禁止访问属性: {node.attr}"
        if isinstance(node, ast.Call):
            # ``getattr(obj, name)`` / ``setattr(...)`` 一律拒绝 — 任何 dunder 绕过
            _forbidden = {"getattr", "setattr", "delattr", "vars", "globals", "locals", "compile", "eval", "exec", "open", "__import__"}
            if isinstance(node.func, ast.Name) and node.func.id in _forbidden:
                return f"错误: 禁止调用: {node.func.id}"
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return "错误: 禁止 import"
    return None


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


def _truncate_content(content: str) -> str:
    """超过单文件上限时截断并追加提示，避免 LLM 写超大文件卡住 SSE。"""
    if len(content) <= _MAX_FILE_CONTENT_BYTES:
        return content
    return content[:_MAX_FILE_CONTENT_BYTES] + f"\n\n...[已截断，原长 {len(content)} 字节]"


@tool(args_schema=_WriteFileInput)
def write_file(path: str, content: str) -> str:
    """在工作空间中写入文件（覆盖已有文件）。适用于创建完整文件。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.write_file(path, _truncate_content(content))


@tool(args_schema=_AppendFileInput)
def append_file(path: str, content: str) -> str:
    """向已有文件追加内容。适用于增量修改。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.append_file(path, _truncate_content(content))


@tool(args_schema=_CreateFileInput)
def create_file(path: str, content: str = "") -> str:
    """在工作空间中创建新文件（如果已存在则报错）。安全地创建，避免覆盖。"""
    ws = _get_ws()
    if ws is None:
        return "错误: 未找到工作空间"
    return ws.create_file(path, _truncate_content(content))


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
    timeout: int = Field(default=5, ge=1, le=10, description="超时秒数（1-10）")


def _deny_isinstance(*_args: object, **_kwargs: object) -> bool:
    """isinstance 的沙箱替代：始终返回 False（拒绝反射元类链）。"""
    return False


# run_code 沙箱的内置白名单 — 严格只放纯函数与构造器，
# 移除 type/Exception/True/False/None 以切断反射链。
# ``isinstance`` 被替换为始终返回 False 的桩。
_SANDBOX_BUILTINS: dict[str, object] = {
    "print": print,
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
    "frozenset": frozenset,
    "sum": sum,
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "pow": pow,
    "sorted": sorted,
    "reversed": reversed,
    "enumerate": enumerate,
    "zip": zip,
    "map": map,
    "filter": filter,
    "all": all,
    "any": any,
    "iter": iter,
    "next": next,
    "repr": repr,
    "hex": hex,
    "oct": oct,
    "bin": bin,
    "chr": chr,
    "ord": ord,
    "hash": hash,
    "callable": callable,
    "isinstance": _deny_isinstance,
}


def _run_code_subprocess(code: str, q: _mp.Queue[str]) -> None:  # pragma: no cover - 子进程路径
    """子进程入口：执行用户代码，把 stdout/stderr 写入 Queue 后退出。"""
    captured = io.StringIO()
    safe_globals = {"__builtins__": _SANDBOX_BUILTINS}
    safe_locals: dict[str, object] = {}
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = captured, captured
    try:
        compiled = compile(code, "<run_code>", "exec")
        exec(compiled, safe_globals, safe_locals)  # noqa: S102 — 沙箱已白名单
        q.put(captured.getvalue() or "(代码执行成功，无输出)")
    except BaseException as exc:  # noqa: BLE001
        # 输出给 LLM 的错误信息：仅类型名 + 截断消息，不含 traceback 中的绝对路径
        msg = str(exc)[:200] or type(exc).__name__
        q.put(f"执行错误: {type(exc).__name__}: {msg}")
    finally:
        with contextlib.suppress(Exception):
            sys.stdout, sys.stderr = old_stdout, old_stderr


def _safe_run_code(code: str, timeout: int = 5) -> str:
    """在工作空间中执行 Python 代码并返回输出。

    安全要点：
    - 静态 AST 校验：禁止 dunder 属性访问、``getattr/setattr/...``、``import``
    - 真超时：``multiprocessing.Process`` + ``terminate()``，避免 CPU 阻塞事件循环
    - 内置白名单仅含纯函数；``isinstance`` 被替换为始终返回 False
    - 不向 LLM 回显完整 traceback，避免路径/堆栈泄漏
    """
    if not isinstance(code, str):
        return "错误: 代码必须是字符串"
    if len(code) > 16 * 1024:
        return "错误: 代码过长（>16KB）"
    timeout = max(1, min(int(timeout), 10))

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError:
        return "错误: 代码语法错误"

    reject_reason = _validate_run_code_ast(tree)
    if reject_reason is not None:
        return reject_reason

    ctx = _mp.get_context("spawn")
    q: _mp.Queue[str] = ctx.Queue()  # type: ignore[assignment]
    proc = ctx.Process(target=_run_code_subprocess, args=(code, q), daemon=True)
    proc.start()
    proc.join(timeout=timeout)

    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=2)
        if proc.is_alive():
            proc.kill()
            proc.join(timeout=1)
        return f"执行超时（>{timeout}s），已强制终止"

    if proc.exitcode != 0:
        return f"执行错误: 子进程退出码 {proc.exitcode}"

    try:
        return q.get_nowait()
    except Exception:
        return "(代码执行成功，无输出)"


@tool(args_schema=_RunCodeInput)
def run_code(code: str, timeout: int = 5) -> str:
    """在工作空间中执行 Python 代码并返回输出。沙箱限制：无网络/文件系统/子进程/反射。"""
    return _safe_run_code(code, timeout)


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
    """获取当前 Agent 运行的工作空间（通过 ContextVar）。"""
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