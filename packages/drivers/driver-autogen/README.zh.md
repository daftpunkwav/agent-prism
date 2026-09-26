# `@agentprism/driver-autogen`

> 语言：**简体中文** | [English](README.md)

AutoGen 模式 framework driver：带 LLM speaker 选择的可对话 group chat。

- `AutogenDriver`，`frameworkId "autogen"`。
- coder 与 reviewer 两种角色按轮次运行；user proxy 执行 tool 调用。
- 选择与 critique 经 `reflect` event 承载，因此 coder 的 thought 携带答案。
- `max_steps` 为每次 group-chat LLM 调用设预算，选择与 speaker 轮次同样计入。
- `reviewerBudgetFor` 在 reflexion 下额外给一轮 reviewer。
- 这是 AutoGen group-chat 模型在 arena 共享 port 上的同构实现，不是厂商代码。

## 依赖

- Runtime：`contracts / driver-run-support / harness / telemetry`。

## 运行时

该 driver 每次列运行在两个可互换的后端之间选择：

- **Python 桥（真实 AutoGen）**——当带有 `autogen_agentchat` 包的 Python 解释器可用时
  为默认。`python/bootstrap.py` 运行真实的 `RoundRobinGroupChat`（coder + reviewer，
  `TERMINATE` 终止），经 NDJSON 与宿主通信：每次模型补全都回环到 arena 模型端口，每次
  tool 调用都经 arena tool 注册表执行，因此凭据不会离开宿主进程，tool 策略/日志/预算
  原样生效。安装：将 `pip install -r python/requirements.txt` 装进 `ARENA_PYTHON` 指向的
  解释器（默认 `python`，其次 `python3`）。探测结果在 server 进程生命周期内缓存——
  安装框架后需重启运行时。
- **TypeScript 模式回退**——探测失败时使用。中性 transcript 的 group-chat 循环带 LLM
  speaker 选择；相同 event，相同预算。

`ARENA_AUTOGEN_RUNTIME` 强制指定一侧：`python`（不可用时失败关闭）、`ts`（跳过探测）
或 `auto`（默认）。
