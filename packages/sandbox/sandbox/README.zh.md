# `@agentprism/sandbox`

> 语言：**简体中文** | [English](README.md)

审查阶段的 shell 安全策略：shell tool（`bash`、`run_job`、`bash_session`）执行前所做的
静态分析与审批决策。

## 模块

| 模块 | 职责 |
|---|---|
| `command-analysis.ts` | `LayeredSandboxPolicy`（默认策略）：引号感知的分段解析；命令替换在 shell 真正执行它的所有位置都会审查（包括双引号内）；解释器包装（`bash -lc`、`cmd.exe /c`、PowerShell `-Command`/`-EncodedCommand`）会被重新解析并递归审查。拒绝受保护根目录的蓄意破坏、块设备写入、格式化与 fork bomb。`isKnownSafeCommand` 是审批闸门背后的只读允许列表。 |
| `sandbox-policy.ts` | Policy seam 的再导出、遗留的引号不感知 `DenyListSandboxPolicy`（兼容用途）、显式 `AllowAllSandboxPolicy` 退出开关，以及三个携带 shell 命令的 tool 的 registry hook 适配器 `toBeforeExecute`。 |
| `approval.ts` | `ApprovalGate` 与 `normalizeApprovalMode`：`unless_trusted` 只放行已知安全的只读命令，其余需要审批；未知模式失败关闭为该模式。 |
| `sandbox-mode.ts` | `normalizeSandboxMode`：`off`（默认）或 `os`；未知值告警并回退到 `off`，OS 层 containment 保持显式启用。 |
| `removal-targets.ts` | 两个 deny 策略共用的删除目标规范化与受保护 POSIX/Windows 根集合。 |

静态层是护栏而非安全边界：无法归类的命令会放行，接受任意代码的解释器
（`python -c`、`node -e`）不在静态分析覆盖范围内。OS 写入 containment 位于
`@agentprism/environment`；完整模型见
[docs/architecture/sandbox-layers.md](../../../docs/architecture/sandbox-layers.md)。

## 依赖

- Runtime：仅 `contracts`。
