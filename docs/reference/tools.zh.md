# Tool

> 语言：**简体中文** | [English](tools.md)

事实来源：toolset 成员见 `packages/contracts/contracts/src/enums.ts` 的
`TOOL_NAMES_BY_TOOLSET`，definitions 见
`packages/tools/tool-builtins/src/definitions/`，registry 见
`packages/tools/tool-registry/src/`。当本页与代码不一致时，以代码为准。

## Toolsets

| Toolset | Tools，22 / 19 / 10 |
|---|---|
| `full` | read, write, edit, ls, bash, apply_patch, glob, grep, web_fetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter |
| `edit_run` | `full` 减去 `ls`、`web_fetch`、`web_search`，保留 glob 与 grep |
| `read_only` | read, ls, glob, grep, subagent, skill, ralph_loop, session_query, symbols, scatter |

解析语义见 `tool-registry/src/toolset.ts`：未知 toolset 解析为 `read_only`；空或未设
的 toolset 解析为 `full`；遗留别名把 `code_file` 映射到 `edit_run`，把 `calc_time`
或 `workspace_read` 映射到 `read_only`。

## 内置 tool

| Tool | 用途与上限 | Toolsets |
|---|---|---|
| `read` | 文件读取，`offset` 与 `limit` 从 1 开始；输出上限 256 KB；仅裸截断，因为它是 spill 取回路径 | all |
| `write` | 创建或覆盖；拒绝超过 256 K 字符的内容，而非截断 | full, edit_run |
| `edit` | 精确 `old_text` 到 `new_text` 替换；`new_text` 超过 256 K 字符被拒绝 | full, edit_run |
| `ls` | 列举，或空 path 加 recursive 时的完整 workspace 树 | all |
| `bash` | workspace cwd 中的 shell；超时钳制 1 至 120 秒，默认 30；Windows 上使用 PowerShell 5.1；长输出 spill | full, edit_run |
| `apply_patch` | V4A 多文件 patch，含 `*** Begin Patch` 与 Add、Update、Delete、Move-to 指令；非原子，早先的 hunk 会持久 | full, edit_run |
| `glob` | glob 搜索，支持 `**`、`*`、`?`、`[abc]`、`{a,b}` | all |
| `grep` | regex 内容搜索，返回 `path:line: text`；最多 200 匹配行；每行窗口 20 000 字符 | all |
| `web_fetch` | http 或 https 转可读文本；15 秒超时；HTML 剥离前 body 上限 512 KB | full |
| `todo_write` | 整表替换的计划列表；50 项、每项 500 字符；持久化 `.agent-todos.json` | full, edit_run |
| `ask_user` | 把问题记录到 `.agent-questions.json`，每次调用至多 5 条、共存 50 条；headless 运行绝不阻塞并指示模型继续，interactive 运行把问题内联交给人工回答（有界等待，超时后同样降级）；问题可带选项与 `multiSelect` 多选 | full, edit_run |
| `web_search` | 经 `SEARCH_PROVIDER` 与 `SEARCH_API_KEY` 使用 Exa 或 Tavily；未配置则失败关闭并给出设置提示；15 秒超时；1 至 10 条结果，默认 5 | full |
| `run_job` | 后台 job，含 `start`、`poll`、`kill`、`list`；每 workspace 8 个活跃 job；poll 只返回 delta；输出超过 32 K spill 到 `.spills/*.log`；进程作用域，重启后出现孤儿 | full, edit_run |
| `bash_session` | 每 workspace 一个持久 POSIX shell，`cd` 与 `export` 存活；哨兵分隔帧；Windows 失败关闭并转向 `bash` 与 `run_job` | full, edit_run |
| `subagent` | 嵌套委派，`spawn` 为空白历史或 `fork` 为父 transcript；子级 step 默认 8，范围 1 至 10；深度上限 1；token 折叠进父级 | all |
| `skill` | `list` 与 `read` runbook，来自内置集合、全局用户目录（`data/skills/`）与 workspace `.skills/<name>/SKILL.md` 覆盖（优先级 workspace > 用户 > 内置）；在 settings 中停用的名称被过滤；kebab-case 命名 | all |
| `goal` | `.agent-goal.json` 中一个持久目标；状态 `active`、`paused`、`blocked`、`completed`；blocked 需要原因 | full, edit_run |
| `ralph_loop` | 固定轮次循环；轮次默认 3，范围 1 至 8；读取一行 `STATUS:`，其余透传，上限 4 000 字符 | all |
| `plan` | 提案并记录文档 `.agent-plan.md`，必须以 `#` 开头；至多 8 000 字符；只记录，绝不提交 | full, edit_run |
| `session_query` | 只读账本查询 `list`、`read`、`read_entry`；limit 默认 10，硬上限 50；`read_entry` 按行分页已 spill 的 blob 文本 | all |
| `symbols` | 代码导航，含 `defs`、`refs`、`search`、`dependents`，来自 `@agentprism/tool-symbols` | all |
| `scatter` | 扇出占位符：2 至 8 个子任务，每子级 step 1 至 10，并发 3，`concat` 或 `vote` 策略 | all |

占位符模式：`subagent`、`ralph_loop`、`session_query`、`scatter` 在此注册失败关闭的
占位符。实体 body 位于 `@agentprism/agent`，执行时按名覆盖，或绑定注入的 port 如
`SessionQueryPort`。

## `MapToolRegistry` 执行机制

- 授权：只有为某列的 toolset 选中的名称才执行。其他一切返回 `unauthorized_tool`。
- `beforeExecute` 与 `afterExecute` hook：sandbox deny policy 经 `beforeExecute`
  承载，其灾难性形态不可覆盖。重复调用提醒经 `afterExecute` 承载，来自
  `harness/control/repeat-reminder.ts`，仅建议、绝不否决，阈值 `[3, 5, 8]`。
- 超时是协作式 deadline，产生结构化 `timeout` 结果。
- 结果码：`unknown_tool`、`unauthorized_tool`、`workspace_error`、`aborted`、
  `timeout`。

## `tool-builtins/src/definitions/` 中的 output-budget helper

| Helper | 阈值 | 行为 |
|---|---|---|
| `caps.ts` 中的 `truncate` | `MAX_OUTPUT` 32 K 字符与 `MAX_FILE` 256 K | 中部修剪，保留 head 与 tail，其中 `tail <= min(4096, max/5)`，标记为 `…[middle pruned: ~N tokens total]…`，使用 contracts `CHARS_PER_TOKEN` 的字符代理估算 |
| `spill.ts` 中的 `boundText` 与 spill | 32 KiB UTF-8 时 spill；每文件上限 512 K 字符；保留 20 个文件，最旧的 `spill-*.txt` 被驱逐 | 全文写入 `.spills/spill-NNNNNN-<tool>.txt`；模型看到 locator 与预览；dump 失败降级为响亮的截断而非错误 |

## `packages/tools/tool-mcp` 中的 MCP tool

- 进程内 server，`mcp__` 前缀：`mcp__fs_list` 含 200 条目与 8 K 字符输出，
  `mcp__fs_read` 上限 16 KB 并做 head 与 tail 修剪，`mcp__fetch_url` 仅 http 或
  https，默认 8 000 字符、上限 16 000。
- 策略到 tool：`off` 不挂载；`fs` 挂载 `fs_list` 与 `fs_read`；`full` 增加
  `fetch_url`，后者与 web_fetch、web_search 一样仅属 `full` toolset。
- 远程 stdio server 来自 `MCP_SERVERS` env var，即
  `{command, args?, env?, timeoutMs?, tools?}` 的 JSON 数组，其中每 server 的
  `timeoutMs` 默认 30 000 ms。tool 命名空间为 `mcp__<server>__<tool>`，仅在 arena
  顶层列上尽力挂载。宕机 server 告警并跳过，嵌套 turn 绝不继承进程，`read_only`
  列绝不挂载远程。
