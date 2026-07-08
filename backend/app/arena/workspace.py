"""Agent 工作空间 — 每个 Agent 运行实例的隔离文件系统。"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field


# 线程本地存储当前运行的工作空间名称
_thread_local = threading.local()


def set_current_workspace(name: str) -> None:
    _thread_local.workspace_name = name


def clear_current_workspace() -> None:
    _thread_local.workspace_name = ""


def get_current_workspace_name() -> str | None:
    return getattr(_thread_local, "workspace_name", None)


@dataclass
class WorkspaceFile:
    """工作空间中的文件。"""
    path: str
    content: str = ""
    created_at: str = ""


@dataclass
class Workspace:
    """内存文件系统工作空间。每个 Pipeline 运行实例独享一个。"""

    name: str
    files: dict[str, WorkspaceFile] = field(default_factory=dict)
    created_at: str = ""

    def _normalize(self, path: str) -> str:
        """规范化路径，防止目录遍历。"""
        # 拒绝绝对路径
        path = path.strip()
        if not path or path.startswith("/") or path.startswith("\\"):
            return ""
        # 规范化
        path = os.path.normpath(path).replace("\\", "/")
        # 拒绝向上遍历
        if path in ("..", "../", ".") or path.startswith("../"):
            return ""
        # 移除可能的前导 ./
        if path.startswith("./"):
            path = path[2:]
        return path

    def list_files(self, dir_path: str = "") -> list[str]:
        """列出目录下的文件。"""
        dir_path = self._normalize(dir_path)
        prefix = f"{dir_path}/" if dir_path else ""
        results: list[str] = []
        for path in self.files:
            if path.startswith(prefix):
                rel = path[len(prefix):]
                # 只返回直接子项
                if "/" not in rel and rel:
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
    """管理所有运行实例的工作空间。"""

    def __init__(self) -> None:
        self._workspaces: dict[str, Workspace] = {}

    def create(self, name: str) -> Workspace:
        """创建新工作空间。"""
        ws = Workspace(name=name)
        self._workspaces[name] = ws
        return ws

    def get(self, name: str) -> Workspace | None:
        return self._workspaces.get(name)

    def remove(self, name: str) -> None:
        self._workspaces.pop(name, None)

    def cleanup(self) -> None:
        self._workspaces.clear()
