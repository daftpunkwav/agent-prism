# Threads

> 语言：**简体中文** | [English](threads.md)

持久 agent thread 由服务端持有的 transcript 与每个 thread id 一个持久 workspace
组成。它面向 fork 与 resume 设计：fork 分支一段过去的对话，resume 在中断或重启后
继续。事实来源：store 见 `packages/application/application/src/thread-store.ts`，
用例见 `thread-service.ts`，routes 见 `packages/transport/route-threads`，
contracts 见 `packages/contracts/contracts/src/thread.ts`。

## 语义

- Resume 是 thread 级，而非 step 级。一个 turn 仅在成功完成时提交，把问题、提取的
  答案与已解析的 workspace 在一次原子写入中追加。失败或中止的 turn 使 transcript
  保持原样，因此下一次 run 从最后提交点恢复。不存在中途暂停，因为 run 从已提交
  历史重启该 turn。
- 历史与 workspace 在服务端重放。每次 run 都走完整 arena pipeline，覆盖并发槽、
  circuit breaker、events、workspace 重水化，以及 sandbox 与 approval 层，并携带该
  thread 的 pinned `PipelineConfig`。列 label 经 baseline `label` 覆盖被 pin 为
  `t-<threadId>`。
- transcript 的跨重启自动成立。`data/threads.json` 以带防抖的原子写持久化 threads，
  含 `.bak` 恢复与逐项损坏遏制。上一进程遗留的 `running` 标志在加载时重置为 idle。
  在下一次 run 或详情读取时，workspace 从 `data/runs/` 重水化并被 pin，从而在该
  thread 生命周期内经 `WorkspaceRegistry.pin` 豁免 workspace registry 的 TTL 与
  LRU 淘汰，直到被删除。被 pin 的 workspace 仍占用 registry 配额。thread 上限与
  registry 大小由 `MAX_THREADS` 与 `MAX_WORKSPACES` 经 env 调节，且 settings 会快速
  失败除非 registry 超过 thread 上限，使 pin 无法完全挤掉 arena 列。
- config 在创建时被 pin。`POST /api/threads` 捕获的完整 `PipelineConfig` 在每次 run
  时重放。baseline 支持的字段一对一映射，`model_id` 从 endpoint 解析派生。创建时用
  与 run 路径相同的 resolver 校验 config，因此不可重放的值在创建时返回 `422`，而非
  之后每次 run 都在流内报错。未设的 `endpoint_id` 被省略，使默认 endpoint 仍可解析。
  `prompt_version` 不是 baseline 字段，它跟随运行中的 build 而非 thread，因此在
  prompt 升级后恢复的 thread 会拾取新 prompt。

## Fork

`POST /api/threads/:id/fork` 复制 transcript 与 `config`，打上 `fork_of`，并在父级有
workspace 时用 `WorkspaceRegistry.clone` 分支它，即在源旁做逐字节目录复制。两棵树
独立分叉。fork 运行中的 thread 返回 `409`，在源 workspace 被活跃 run 保护期间 fork
返回 `409`，失败的分支不留任何记录。

## 上限与生命周期

所有数值上限都经 `MAX_THREADS`、`THREAD_MAX_HISTORY_MESSAGES`、
`THREAD_MAX_HISTORY_CHARS` 通过 env 调节。表中为默认值。

| 上限 | 默认 | 行为 |
|---|---|---|
| 每 store 的 threads | 24，来自 `MAX_THREADS` | 满时 create 或 fork 返回 `409`，不淘汰 |
| 历史消息 | 60，来自 `THREAD_MAX_HISTORY_MESSAGES` | 最旧的 user 与 assistant 对被丢弃 |
| 历史字符 | 96 000，来自 `THREAD_MAX_HISTORY_CHARS` | 每次提交后与消息上限一并应用 |
| 标题 | 120 字符 | 空解析为生成的 `Thread <base36 time>` |
| 每条消息协议上限 | 32 000 字符 | `ThreadMessageSchema` |

字符上限是面向窗口的旋钮。driver 每次 LLM 调用按 context 策略的窗口裁剪，默认
`sliding` 与最后 12 条消息，因此最坏情形 prompt 大小由每条消息钳制乘以窗口以及该
字符上限共同约束。请按在用 endpoint 中最小的 context 窗口来设定。

这些上限刻意比 arena 协议上限 `column_sessions` 更宽松。thread 历史绝不作为请求
状态跨 HTTP，context 裁剪交由 pipeline 策略。

存在运行中的 turn 时删除会被拒绝并返回 `409`，此时 workspace pin 保留。workspace
目录保留在磁盘上，因为它归 `data/runs/` 的 TTL 与 LRU 所有。删除父级会使已存在的
fork 的 `fork_of` 指向一个已移除的 id，这是信息性的，而非需要跟随的悬空引用，
因为该 fork 保留自己的 transcript 与 workspace。

## `route-threads/src/threads.ts` 中的 HTTP 暴露面

每次 run 都流经 `ArenaService.run`，因此每个 turn 也会在 `data/sessions.json` 中开启
一个执行账本 session 并带 outline 摘要。这是尽力而为，绝不承重：`data/threads.json`
中的 thread transcript 是权威 resume 状态，账本失败绝不打断 turn。

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET | `/api/threads` | 列出视图，无 transcript | 最旧优先 |
| POST | `/api/threads` | 创建 | body `{title?, config}`；`config` 是完整 `PipelineConfig`，应用默认值；config 无法重放时 `422` |
| GET | `/api/threads/:id` | 详情 | `{thread, history}` |
| DELETE | `/api/threads/:id` | 删除 | 运行中 `409` |
| POST | `/api/threads/:id/fork` | fork | body `{title?}`；transcript 复制与 workspace 分支 |
| POST | `/api/threads/:id/run` | 运行一个 turn，即 resume | SSE，事件名 `"thread"`，载荷与 arena run 同一 event 契约；冲突与 404 在流打开前以 HTTP status code 呈现 |

用既有的 arena 路由 `POST /api/arena/stop-column` 停止一个活跃的 thread turn，使用
流 event 中的 `agentId`。

## Client 映射

`packages/client/client/src/threads.ts` 一对一镜像该暴露面：`listThreads`、
`createThread`、`getThread`、`forkThread`、`deleteThread`、`streamThreadRun`。

## 测试

- Store：`packages/application/application/tests/thread-store.test.ts` 覆盖上限、
  fork 复制、陈旧 running 重置、损坏遏制。
- Service：`packages/application/application/tests/thread-service.test.ts` 覆盖请求
  装配、仅成功提交、409 守卫、fork 分支、pinned baseline 列表与协议 schema 的对比、
  创建时校验、被拒删除时的 pin 保留。
- Registry：`packages/runtime/runtime/tests/workspace-clone.test.ts` 覆盖复制语义、
  复制期间的源保护、失败时无部分克隆。
- Routes：`packages/transport/route-threads/tests/threads.test.ts` 覆盖 CRUD、
  SSE 形态、409、404 与 422。
