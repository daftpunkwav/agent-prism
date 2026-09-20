# `@agentprism/tool-builtins`

> 语言：**简体中文** | [English](README.md)

内置 tool 实现。`createBuiltinToolRegistry()` 注册二十二个 tool definition：read、
write、edit、ls、run、apply_patch、glob、grep、webfetch、todo_write、ask_user、
web_search、run_job、bash_session、subagent、skill、goal、ralph_loop、plan、
session_query、symbols、scatter。文件系统与子进程访问在 `ScopedFileSystem` 与
`runProcess` 之下运行。`workspace-view` 是各 definition 共用的视图 helper，不是已
注册的 tool。

## 依赖

- Runtime：`contracts / environment / tool-registry / tool-symbols`。
