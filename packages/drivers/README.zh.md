# drivers/

> 语言：**简体中文** | [English](README.md)

执行语义的框架适配层：一个 run column 可以在任何受支持的 framework 上执行。
`driver-run-support` 拥有 `DriverLookup` seam 与共享 run 支持；每个 backend leaf 只适配
一个 framework，并在唯一的组合根 `apps/server/src/assemble.ts` 显式注册。重型框架
依赖只存在于 backend leaf，seam 与 native backend 保持无 LangChain。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`driver-run-support/`](driver-run-support/README.md) | Driver 服务：`DriverLookup` registry、尽力而为的注册 helper、共享 run 支持，含 event translation、capability banner 与 recursion cap | Seam，零 backend 依赖 |
| [`driver-native/`](driver-native/README.md) | 进程内 native driver，无外部 framework | 以 `native` 注册进 `DriverLookup` |
| [`driver-langchain/`](driver-langchain/README.md) | LangChain driver；拥有 LC 与 message bridge | 以 `langchain` 注册进 `DriverLookup` |
| [`driver-langgraph/`](driver-langgraph/README.md) | LangGraph reasoning-graph driver | 以 `langgraph` 注册进 `DriverLookup` |
| [`driver-plan-execute/`](driver-plan-execute/README.md) | Plan-Execute driver：planner 一趟加一个 ReAct executor，允许一次有预算的 replan | 以 `plan_execute` 注册进 `DriverLookup` |
| [`driver-self-critique/`](driver-self-critique/README.md) | Self-Critique driver：无 tool 的 critic 对每批 tool 打分并改向 | 以 `self_critique` 注册进 `DriverLookup` |
| [`driver-autogen/`](driver-autogen/README.md) | AutoGen 模式 driver：带 LLM speaker 选择的 group chat | 以 `autogen` 注册进 `DriverLookup` |
| [`driver-crewai/`](driver-crewai/README.md) | CrewAI 模式 driver：角色 crew 运行任务 pipeline | 以 `crewai` 注册进 `DriverLookup` |
