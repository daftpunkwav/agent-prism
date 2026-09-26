# `@agentprism/driver-deepagents`

> 语言：**简体中文** | [English](README.md)

Deep Agents framework driver：`deepagents` 中间件栈——规划工具、虚拟文件系统与子代理
委派——运行在 LangGraph 之上。

- `frameworkId: deepagents`，banner `[Deep Agents]`。
- 运行真实 `createDeepAgent`，模型取 Arena 的 ChatModel（`llmVendor`），注册表工具
  绑定为 LangChain StructuredTool。
- 共享上下文管线与工具漂移护栏挂在框架自身的 model/tool middleware 上，因此
  context/harness 维度的行为与 LangChain 列一致。
- 框架静态保留 `glob`、`grep`、`ls` 三个内置工具名，任何重名工具都会被拒绝，
  因此本列会剔除注册表中这三个同名工具，改由框架自带版本承担。
- 框架的文件中间件以只读白名单（`read_file`、`ls`、`glob`、`grep`）挂到 Arena
  工作空间：探索读取真实文件，而所有写入与 shell 调用仍走 `tools.execute`，
  不会绕过该列的工具集策略。
- deepagents 不做 token 级流式，因此当 thought 通道没有任何内容时，最后一次完整的
  模型输出会作为收尾 thought 块发出。
