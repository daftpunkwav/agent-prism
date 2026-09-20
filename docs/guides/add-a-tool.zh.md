# 内置 tool

> 语言：**简体中文** | [English](add-a-tool.md)

内置 tool 位于 `packages/tools/tool-builtins/src/definitions/`，由 `src/builtins.ts`
中的 `createBuiltinToolRegistry()` 注册。一个 tool 参与一组固定的暴露面，遗漏任何
一项都会被此处列出的门禁与测试捕获。

## Toolset 成员

tool 名加入 `packages/contracts/contracts/src/enums.ts` 中的
`TOOL_NAMES_BY_TOOLSET`，它是"哪个 toolset 携带哪个 tool"的唯一事实来源。放置规则：

- 网络能力 tool `webfetch` 与 `web_search` 仅属于 `full`。
- 有变更潜力的 tool 绝不进入 `read_only`。
- 编排与读取辅助类 `subagent`、`skill`、`ralph_loop`、`session_query`、`symbols`、
  `scatter` 三个 toolset 全开。

## Definition

文件 `packages/tools/tool-builtins/src/definitions/<name>.ts` 从 `contracts` 导出
`ToolDefinition`，含 `name`、`description`、`jsonSchema`、`mutatesWorkspace`、可选
`timeoutMs` 与 `execute()`，并在 `src/builtins.ts` 注册。

- 输入校验失败关闭，对重复、空值或超限输入抛错。上限以 `MAX_*` 常量暴露，见
  `todo.ts` 与 `ask-user.ts`。
- 输出经 `definitions/helpers.ts` 中的共享 helper。`truncate()` 在
  `MAX_OUTPUT = 32 * 1024` 字符处中部修剪。`boundText()` 先持久化再修剪到 workspace
  的 `.spills/` 目录。见 [../reference/tools.zh.md](../reference/tools.zh.md)。
- `execute()` 返回结构化 `ToolExecutionResult`，即 `{result, fileDiff, ok, code?}`。
  成功的 write 或 edit 工作后发出 `fileDiff`，使 UI 能渲染 diff。

## 执行层覆盖

其实体 body 需要注入 port 的 tool，即 `subagent`、`ralph_loop`、`session_query`、
`scatter`，注册一个失败关闭的占位定义。`@agentprism/agent` 中的执行层按名以实体
body 覆盖。builder catalog、LC bridge、prompts 等发现面保持绑定到占位符。任何依赖
port 的 tool 都遵循这一拆分。

## 报告暴露面

`packages/evaluation/evaluation/src/ablation.ts` 匹配 event 形态，如 `mcp__*` 前缀与
`subagent` 或 `ralph_loop` 委派。应计入 ablation 行的 tool 在此登记。trace UI 的
summary case 位于 web trace 组件。

## 测试

leaf 测试位于 `packages/tools/tool-builtins/tests/`。经 `MapToolRegistry` 的
toolset 授权等跨域行为在 `tests/` 下补 journey 覆盖。

## 文档

[../reference/tools.zh.md](../reference/tools.zh.md) 的 tool 目录为该 tool 增加一行。

## Toolset 解析语义

- `normalizeToolset`：未知值回退到 `read_only`。
- `resolveToolsetId`：空或未设解析为 `full`。遗留别名把 `code_file` 映射到
  `edit_run`，把 `calc_time` 或 `workspace_read` 映射到 `read_only`。
- `MapToolRegistry` 强制 `authorizedNames`。不在所选 toolset 中的 tool 返回
  `unauthorized_tool`，绝不执行。
- `toolset` dimension 必须暴露至少一个选项。该检查在启动时于
  `apps/server/src/assemble.ts` 运行。
