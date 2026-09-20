# `@agentprism/driver-crewai`

> 语言：**简体中文** | [English](README.md)

CrewAI 模式 framework driver：角色 crew 运行任务 pipeline。

- `CrewAIDriver`，`frameworkId "crewai"`。
- research、implement、verify 三个任务顺序执行，由角色 worker 承担。
  `ARENA_CREWAI_PROCESS=hierarchical` 切换到 manager 流程。
- 任务边界与 manager 委派经 `reflect` event 承载；worker 的 thought 携带答案，
  pipeline 在 reviewer 的轮次结束。
- `max_steps` 为每次 crew LLM 调用设预算，`taskTurnCapFor` 在 reflexion 下为每个任务
  额外给一轮。
- 这是 CrewAI 的 crew、task、process 模型在 arena 共享 port 上的同构实现，不是厂商
  代码。

## 依赖

- Runtime：`contracts / driver-registry / harness / telemetry`。
