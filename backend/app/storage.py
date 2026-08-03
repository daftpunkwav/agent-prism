"""持久化辅助：原子 JSON 写、备份、目录创建。

为避免配置/项目数据在写一半时崩溃导致文件损坏，统一走 ``_atomic_write_json``：
1. 把 JSON 写入同目录下的临时文件（``*.tmp``）
2. ``os.replace`` 原子替换目标文件
3. 旧版本备份到 ``<name>.bak``（仅当目标已存在）
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path


def _atomic_write_json(path: Path, payload: object, *, backup: bool = True) -> None:
    """原子写入 JSON 文件。可选备份旧版本到 ``<name>.bak``。

    Parameters
    ----------
    path : Path
        目标文件路径。
    payload : object
        任意可被 :func:`json.dumps` 序列化的对象。
    backup : bool
        若目标已存在，是否将其复制到 ``<name>.bak``。默认为 True。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    # 写临时文件
    with tmp.open("w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    # 备份旧文件
    if backup and path.exists():
        bak = path.with_suffix(path.suffix + ".bak")
        try:
            shutil.copy2(path, bak)
        except OSError:
            # 备份失败不阻塞主流程（best-effort）
            pass
    # 原子替换
    os.replace(tmp, path)