# `@agentprism/driver-crewai`

> 语言：**简体中文** | [English](README.md)

CrewAI 模式 framework driver：角色 crew 运行任务 pipeline。

- `CrewAIDriver`，`frameworkId "crewai"`。
- research、implement、verify 三个任务顺序执行，由角色 worker 承担。
  `ARENA_CREWAI_PROCESS=hierarchical` 切换到 manager 流程。
- 任务边界与 manager 委派经 `reflect` event 承载；worker 的 thought 携带答案，
  pipeline 在 reviewer 的轮次结束。
- `max_steps` 为每次 crew LLM 调用设预算，`taskTurnCapFor` 在 reflexion 下为每个任务
  额外给一轮 turn。
- 测试：`tests/crewai-bridge.test.ts` 以假 bootstrap 驱动协议；`tests/crewai-live-bridge.test.ts`
  用脚本化宿主模型端到端运行真实 `python/bootstrap.py`（没有解释器能导入该框架时自动跳过；
  crewai 需要 Python < 3.14）。
- 这是 CrewAI 的 crew、task、process 模型在 arena 共享 port 上的同构实现，不是厂商
  代码。

## 依赖

- Runtime：`contracts / driver-run-support / harness / telemetry`。

## 运行时

该 driver 每次列运行在两个可互换的后端之间选择：

- **Python 桥（真实 CrewAI）**——当带有 `crewai` 包的 Python 解释器可用时为默认。
  `python/bootstrap.py` 运行真实的 `Crew`（researcher/coder/reviewer，
  `ARENA_CREWAI_PROCESS` 选择 sequential 还是 hierarchical），经 NDJSON 与宿主通信：
  每次模型补全都回环到 arena 模型端口，每次 tool 调用都经 arena tool 注册表执行，因此
  凭据不会离开宿主进程，tool 策略/日志/预算原样生效。宿主按进程内列同样的方式准备每次
  补全——arena system prompt 合并到 crew 角色说明之前、套用该列的上下文管线、首次请求
  拼接历史轮次——并把装配好的任务提示（问题 + @提及 + 检索 + profile 后缀）交给 crew。角色发言
  走 `reflect`，crew 自身的最终输出作为该列的答案落在 thought 通道。子进程以非交互方式运行
  （`CREWAI_TESTING`）：否则 crewai 1.x 会在 stdin 上询问首轮 trace 同意，而 stdin 承载的是
  桥协议。
  安装：将 `pip install -r python/requirements.txt` 装进 `ARENA_PYTHON` 指向的解释器
  （默认 `python`，其次 `python3`）。探测结果在 server 进程生命周期内缓存——安装框架后
  需重启运行时。
- **TypeScript 模式回退**——探测失败时使用。中性 transcript 的 crew pipeline
  （sequential 与 hierarchical manager 委派）；相同 event，相同预算。

`ARENA_CREWAI_RUNTIME` 强制指定一侧：`python`（不可用时失败关闭）、`ts`（跳过探测）
或 `auto`（默认）。
