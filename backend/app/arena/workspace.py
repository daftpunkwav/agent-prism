"""Agent 工作空间 — 每个 Agent 运行实例的隔离文件系统。

使用 contextvars.ContextVar 而非 threading.local：
asyncio 任务可能在不同线程间调度，threading.local 会在 await 时丢失上下文；
contextvars 是 Python 异步栈感知的官方方案。
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# 上下文变量：当前请求/任务的工作空间名称
_current_workspace: ContextVar[str | None] = ContextVar("current_workspace", default=None)

# 默认：最多保留 32 个工作空间；空闲超过 1 小时回收
DEFAULT_MAX_WORKSPACES = 32
DEFAULT_TTL_SECONDS = 3600.0


def set_current_workspace(name: str) -> None:
    _current_workspace.set(name)


def clear_current_workspace() -> None:
    _current_workspace.set(None)


def get_current_workspace_name() -> str | None:
    return _current_workspace.get()


# 控制字符集合（含空字节 \x00）
_CONTROL_CHARS = set(chr(c) for c in range(0, 32)) | {"\x7f"}


def _has_control_chars(s: str) -> bool:
    """检查字符串是否包含控制字符。"""
    return any(c in _CONTROL_CHARS for c in s)


@dataclass
class WorkspaceFile:
    """工作空间中的文件。"""

    path: str
    content: str = ""


@dataclass
class Workspace:
    """内存文件系统工作空间。每个 Pipeline 运行实例独享一个。"""

    name: str
    files: dict[str, WorkspaceFile] = field(default_factory=dict)
    created_at: str = ""

    def _normalize(self, path: str) -> str:
        """规范化路径，防止目录遍历。返回空串表示非法。"""
        path = path.strip()
        if not path or path.startswith("/") or path.startswith("\\"):
            return ""
        # 拒绝包含控制字符的路径
        if _has_control_chars(path):
            return ""
        normalized = os.path.normpath(path).replace("\\", "/")
        # 拒绝向上遍历
        if normalized in ("..", "../", ".") or normalized.startswith("../"):
            return ""
        # 移除可能的前导 ./
        if normalized.startswith("./"):
            normalized = normalized[2:]
        return normalized

    def list_files(self, dir_path: str = "", *, recursive: bool = False) -> list[str]:
        """列出目录下的文件。

        recursive=False：仅直接子项（相对 dir_path 的 basename）。
        recursive=True：返回该目录下全部文件的相对路径（根目录时为完整 path）。
        """
        dir_path = self._normalize(dir_path)
        prefix = f"{dir_path}/" if dir_path else ""
        results: list[str] = []
        for path in self.files:
            if prefix:
                if not path.startswith(prefix):
                    continue
                rel = path[len(prefix) :]
            else:
                rel = path
            if not rel:
                continue
            if recursive:
                results.append(path if not prefix else rel)
            elif "/" not in rel:
                results.append(rel)
        return sorted(results)

    def read_file(self, path: str) -> str:
        """读取文件内容。"""
        path = self._normalize(path)
        f = self.files.get(path)
        if f is None:
            return f"错误: 文件不存在: {path}"
        return f.content

    def write_file(self, path: str, content: str) -> str:
        """写入文件（覆盖）。"""
        path = self._normalize(path)
        if path.endswith("/") or not path:
            return "错误: 无效的文件路径"
        # 确保目录存在
        dir_name = os.path.dirname(path)
        if dir_name:
            self._ensure_dir(dir_name)
        self.files[path] = WorkspaceFile(path=path, content=content)
        return f"已写入: {path} ({len(content)} 字节)"

    def append_file(self, path: str, content: str) -> str:
        """追加内容到文件。"""
        path = self._normalize(path)
        existing = self.files.get(path)
        if existing is None:
            return f"错误: 文件不存在: {path}（请先用 write_file 创建）"
        existing.content += content
        return f"已追加 {len(content)} 字节到: {path}"

    def create_file(self, path: str, content: str = "") -> str:
        """创建新文件，如果已存在则报错。"""
        path = self._normalize(path)
        if path.endswith("/") or not path:
            return "错误: 无效的文件路径"
        if path in self.files:
            return f"错误: 文件已存在: {path}（请用 write_file 覆盖）"
        dir_name = os.path.dirname(path)
        if dir_name:
            self._ensure_dir(dir_name)
        self.files[path] = WorkspaceFile(path=path, content=content)
        return f"已创建: {path}"

    def delete_file(self, path: str) -> str:
        """删除文件。"""
        path = self._normalize(path)
        if path not in self.files:
            return f"错误: 文件不存在: {path}"
        del self.files[path]
        return f"已删除: {path}"

    def file_tree(self) -> str:
        """返回文件树字符串。"""
        if not self.files:
            return "(空)"
        lines: list[str] = [f"📁 {self.name}/"]
        for path in sorted(self.files):
            lines.append(f"  📄 {path} ({len(self.files[path].content)} 字节)")
        return "\n".join(lines)

    def _ensure_dir(self, dir_path: str) -> None:
        """确保目录存在（在工作空间中创建占位）。"""
        dir_path = self._normalize(dir_path)
        dir_marker = f"{dir_path}/.gitkeep"
        if dir_marker not in self.files:
            self.files[dir_marker] = WorkspaceFile(path=dir_marker, content="")


class WorkspaceManager:
    """管理所有运行实例的工作空间。

    策略：
    - **TTL**：超过 ``ttl_seconds`` 未访问则回收
    - **LRU 上限**：数量超过 ``max_workspaces`` 时淘汰最久未访问项
    - 线程安全：create/get/remove/cleanup 均持锁
    """

    def __init__(
        self,
        max_workspaces: int = DEFAULT_MAX_WORKSPACES,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._workspaces: dict[str, Workspace] = {}
        self._last_access: dict[str, float] = {}
        self._max_workspaces = max(1, int(max_workspaces))
        # 允许测试用亚秒 TTL；生产默认 3600
        self._ttl_seconds = max(0.05, float(ttl_seconds))
        self._lock = threading.RLock()

    def create(self, name: str) -> Workspace:
        """创建新工作空间（同名覆盖）。会先按 TTL/容量回收。"""
        with self._lock:
            self._evict_expired_unlocked()
            if name not in self._workspaces and len(self._workspaces) >= self._max_workspaces:
                self._evict_lru_unlocked(need=1)
            now = time.monotonic()
            ws = Workspace(
                name=name,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            self._workspaces[name] = ws
            self._last_access[name] = now
            return ws

    def get(self, name: str) -> Workspace | None:
        """获取工作空间；命中时刷新访问时间。过期项返回 None。"""
        with self._lock:
            self._evict_expired_unlocked()
            ws = self._workspaces.get(name)
            if ws is not None:
                self._last_access[name] = time.monotonic()
            return ws

    def remove(self, name: str) -> None:
        with self._lock:
            self._workspaces.pop(name, None)
            self._last_access.pop(name, None)

    def cleanup(self) -> None:
        """清空全部工作空间。"""
        with self._lock:
            self._workspaces.clear()
            self._last_access.clear()

    def cleanup_expired(self) -> int:
        """主动清理过期工作空间，返回删除数量。"""
        with self._lock:
            return self._evict_expired_unlocked()

    def count(self) -> int:
        with self._lock:
            return len(self._workspaces)

    def _evict_expired_unlocked(self) -> int:
        """删除超过 TTL 未访问的工作空间。调用方须持锁。"""
        now = time.monotonic()
        expired = [
            name
            for name, ts in self._last_access.items()
            if now - ts > self._ttl_seconds
        ]
        for name in expired:
            self._workspaces.pop(name, None)
            self._last_access.pop(name, None)
        if expired:
            logger.info("Workspace TTL 回收 %d 个: %s", len(expired), ", ".join(expired[:5]))
        return len(expired)

    def _evict_lru_unlocked(self, need: int = 1) -> int:
        """按最久未访问淘汰，直到腾出 need 个名额。调用方须持锁。"""
        removed = 0
        while removed < need and self._workspaces:
            # 最久未访问优先
            oldest = min(self._last_access.items(), key=lambda kv: kv[1])[0]
            self._workspaces.pop(oldest, None)
            self._last_access.pop(oldest, None)
            removed += 1
            logger.info("Workspace LRU 淘汰: %s", oldest)
        return removed
