# sandbox/

> 语言：**简体中文** | [English](README.md)

Shell 命令 containment seam：分层静态分析拒绝灾难性形态，审批闸门可把 shell 工具
限制为已知安全的命令，`sandbox_mode` 为被 spawn 的子进程选择 OS 级写入
containment。静态层是护栏，不是安全边界；OS 层在 Windows 上强制仅 workspace 可写。
完整模型与边界见
[docs/architecture/sandbox-layers.zh.md](../../docs/architecture/sandbox-layers.zh.md)。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`sandbox/`](sandbox/README.md) | Policy 与 hook adapter：`LayeredSandboxPolicy` 为默认，另有 `DenyListSandboxPolicy`、`AllowAllSandboxPolicy`、`toBeforeExecute`；感知引号的 `command-analysis`；`ApprovalGate` 与 `normalizeApprovalMode`；`normalizeSandboxMode` | 默认装配进 agent 执行链，即审查链加 config 规范化 |

OS 写沙箱本身位于 `packages/environment`，含 spawn 变换与 restricted-token helper；
本 package 负责审查阶段的决策。
