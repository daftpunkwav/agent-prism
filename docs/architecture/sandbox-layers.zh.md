# 沙箱执行层

> 语言：**简体中文** | [English](sandbox-layers.md)

运行时通过三层相互独立的机制，约束 shell 工具能做什么，包括 `bash`、`run_job`，
以及 POSIX 上的 `bash_session`。这三层位于模型发出的命令与操作系统之间。每一层
只能增加拒绝。最深的一层在 OS 层强制，而非通过检查命令文本判断。

| 层 | Package | 机制 | 启用方式 |
|---|---|---|---|
| 1. 静态命令分析 | `packages/sandbox`，`command-analysis.ts` | 感知引号的 tokenizer、分层 deny 规则、只读 allowlist。拒绝灾难性形态，如 `rm -rf` 根目录、擦盘、解释器包裹的隐藏命令 | 始终启用；灾难性拒绝是底线 |
| 2. 审批闸门 | `packages/sandbox`，`approval.ts` | `approval_mode: unless_trusted` 把 shell 工具限制为已知安全的只读命令 | `config.approval_mode`，baseline 字段 |
| 3. OS 写沙箱 | `packages/environment`，`sandbox-launcher.ts` 与 `win-sandbox-helper.ts` | Windows restricted-token spawn，子进程只能在 workspace 根内写入 | `config.sandbox_mode: os`，baseline 字段 |

`beforeExecute` 链上的审查顺序见 `agent/src/agent-execution.ts` 的
`buildToolAccess`：调用方 hook，然后审批闸门，然后静态分析。OS 层不是审查步骤。
它包裹 `process-runner.ts` 中通过审查者的实际 spawn，因此静态分析无法判断的命令，
如 `python -c "..."` 这类解释器逃逸，仍会被约束。

## 第 3 层机制，Windows restricted token

`process-runner.ts` 把 argv 转换为对 `win-sandbox-helper.ts` 中一个 PowerShell helper
的调用。该 helper 物化在 OS 临时目录下，C# 程序集缓存于其旁。经 P/Invoke 它完成：

1. 从可写根派生一个 capability SID，使用小写路径的 SHA-256，使重复 spawn 复用同一
   SID，授权保持幂等。它在该根及其已存在的后代上为这个 SID 写入一条可继承的
   allow-write ACE。Reparse point，如 junction 与目录符号链接，既不被授权也不被递归
   进入，因为枚举与子进程自身的路径解析会跟随这类链接，而通过它授权"根内"会把
   ACE 写到链接目标 workspace 之外的真实文件上。经由链接的写入因此保持失败关闭。
   只支持一个可写根；多根请求被拒绝，而非收窄。
2. 用 `CreateRestrictedToken` 克隆当前进程 token，使用
   `WRITE_RESTRICTED | LUA_TOKEN | DISABLE_MAX_PRIVILEGE`，限制 SID 为
   `[logon SID, Everyone, capability SID]`。写入访问随后要求目标 DACL 中存在一个
   restricting SID。读取不受影响。
3. 重写 token 的默认 DACL，对 restricting SID 给 `GENERIC_ALL`，使子进程自己创建的
   对象对其自身保持可写。
4. 用 `CreateProcessAsUserW` spawn 命令，继承 stdio，因此宿主的超时、中止、输出上限
   原样生效，并指派到一个 kill-on-close 的 Job Object，杀死 helper 即杀死整个沙箱化
   进程树。
5. 把子进程的 `TEMP` 与 `TMP` 重定向到 `<workspace>/.sandbox-tmp`，使临时文件留在
   可写根内。

任何 setup 失败都会向 stderr 打印一行经 nonce 认证的哨兵，并退出码 3，
`process-runner.ts` 将其映射为进程错误。spawn 绝不静默降级为非沙箱 run。nonce 阻止
意外或惰性的标记碰撞，但它是尽力而为而非防伪造：它在 helper 的命令行上传递，同用户
子进程可读取，例如经 WMI，然后伪造一行 setup 失败。这最多只把一个存活命令的结果
误标为 setup 错误，绝不削弱隔离本身。要消除该暴露面需要一个私有的 setup 状态通道。

## 配置

两种模式都是 per-run 的 `PipelineConfig` 字段，见 contracts `arena.ts`，可作为
Arena 对比中的 baseline-only 控制字段设置，即 `dimensions` 中的
`BASELINE_ONLY_OPTIONS`：

- `approval_mode`：`auto`，默认，或 `unless_trusted`。未知值在
  `normalizeApprovalMode` 中失败关闭为 `unless_trusted`。
- `sandbox_mode`：`off`，默认，或 `os`。未知值在 `normalizeSandboxMode` 中回退到
  `off` 并告警，因此 containment 是选择加入，绝不静默启用。

启用 `sandbox_mode: os` 时，`agent-execution` 会向交给工具的 workspace 附加一个
sandbox 提示，可写根为 workspace 根。`bash` 与 `run_job` 把它转发进每次 spawn。
嵌套 run 继承该配置，因而继承该提示。

## 边界

- 只管写入。restricted token 不限制读取或网络访问。网络强制需要管理员级过滤器，
  超出范围。
- 仅 Windows。在其他平台上 `sandbox_mode: os` 失败关闭：spawn 层报错拒绝，而非
  无沙箱运行。
- 可见失败优于静默逃逸。确实需要在 workspace 之外写入的命令，如全局安装器或
  `%APPDATA%` 中的缓存，以 access-denied 错误失败。此类任务改用
  `sandbox_mode: off` 重跑。
- ACE 生命周期。capability ACE 持续存在于 workspace 根，以及授权时已存在的后代上，
  直到该目录被删除，因为 workspace 是 per-run 的临时树。重水化的旧 workspace 携带
  同一确定性 SID，因此下次 spawn 的授权是 no-op 而非累积。任何同用户进程都能复现
  该 SID；它是 DACL 身份，不是秘密。
- World-writable 位置保持可写。`Everyone` 是 restricting SID 之一，因此 DACL 授予
  World 写访问的路径对子进程仍可写。Windows 默认布局在用户 profile 或系统目录上
  不授予这一点，但共享或配置错误的卷可能授予，沙箱不保护那些位置。
- workspace 内的链接。junction 与目录符号链接被授权遍历跳过，因此它们背后的任何
  东西都不会经 workspace 变得可写。硬链接根本无法由受限子进程创建，因为
  `CreateHardLink` 需要对目标有写访问，而 restricting SID 对 workspace 之外的任何
  东西都拒绝该访问。
- 授权遍历成本。每次 spawn 都会校验根及每个已存在后代的 DACL。已授权条目被跳过但
  仍会读取。因此一个含有数万文件的 workspace 会给每次 spawn 增加 metadata I/O，
  授权的正确性优先于该成本。
- 范围外。`bash_session` 在 Windows 上已失败关闭；在 POSIX 上它保持无沙箱，因为
  持久 shell 仅 POSIX。MCP server 子进程不受本层管辖。
- 首次沙箱 spawn 支付一次 C# 编译，约 1 至 2 秒。之后 spawn 加载缓存的程序集。
  缓存程序集仅在其 C# 源码未变时被复用；源码变化时缓存 DLL 会在写入新源码前删除，
  因此被锁定的 DLL 会持续失败，而非静默运行过期的 containment 代码。

## 测试

- 纯逻辑：`packages/environment/environment/tests/sandbox-launcher.test.ts` 覆盖
  argv 形态、拒绝、哨兵认证。`packages/sandbox/sandbox/tests/` 覆盖分析、审批、
  模式规范化。
- 真实 OS，非 Windows 跳过：
  `packages/environment/environment/tests/win-sandbox.real.test.ts` 固定根内写入
  成功、根外访问拒绝、junction containment、TEMP 重定向、超时杀进程树、以及失败
  关闭 setup。`run-tool.test.ts` 端到端覆盖 tool 级路径。
