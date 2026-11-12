# `@agentprism/environment`

> 语言：**简体中文** | [English](README.md)

沙箱化文件系统与子进程执行：运行时信任边界中文件系统与进程的一侧。仅依赖 `contracts`。

## 模块

| 模块 | 职责 |
|---|---|
| `scoped-filesystem.ts` | `ScopedFileSystem`：所有路径都规范到单一 root（目录穿越、控制字符、Windows 设备名）；读、写、编辑、删除与列表操作一律拒绝 symlink/junction 逃逸。读取支持字节窗口（`readFileHead`），快照导出受预算限制（`snapshotFiles`）。违规以 `WorkspaceError` 失败关闭。 |
| `process-runner.ts` | `runProcess`（一次性执行，带超时与取消）、`spawnBackground`（生命周期由调用方持有）与 `spawnPersistentShell`（仅 POSIX）。不经过 shell，子进程只继承 `childProcessEnv` 允许列表，宿主密钥、代理凭据及其他未列入的变量不会传给子进程；每路输出有上限，避免内存被撑爆。由本模块发起的 kill 决定最终结果：捕获 SIGTERM 后以 0 退出的子进程仍报告 `timeout`/`aborted`，绝不会是 `ok`。 |
| `sandbox-launcher.ts` | `sandbox_mode: os` 的 spawn 变换：把 argv 改写为受限 token helper 的调用，并把带 nonce 认证的 setup 失败哨兵映射为进程错误。无法落实的请求（非 Windows 宿主、可写 root 不恰好一个）直接拒绝，绝不降级为无沙箱运行。 |
| `win-sandbox-helper.ts` | 物化 PowerShell 驱动及其 C# P/Invoke 载体的源码：按 root 派生的 capability ACE、写受限 token、kill-on-close 的 Job Object、把 TEMP/TMP 重定向进可写 root。仅 Windows。 |

OS 层只限制写入：读取与网络不受影响。执行模型及其边界见
[docs/architecture/sandbox-layers.md](../../../docs/architecture/sandbox-layers.md)。

## 依赖

- Runtime：仅 `contracts`。
