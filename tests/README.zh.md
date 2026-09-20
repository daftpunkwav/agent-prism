# 测试布局

> 语言：**简体中文** | [English](README.md)

- `packages/<family>/<leaf>/tests/`：该 leaf 的单元与功能测试，紧邻 `src/`。测试只能
  引用该 package 自身的 `../src/` 与各 package 的公开 barrel。禁止跨 package 的深层
  路径 import。
- `tests/`：位于 `packages/` 旁的跨域测试，按 journey 或边界组织，仅经
  `@agentprism/*` 公开导出导入：
  - `tests/agent-execution/`：横跨 `agent` 与 `runtime` 的 agent run journey，覆盖执行
    记账与 workspace 生命周期。
  - `tests/arena-runner/`：arena 多列 run journey，覆盖 column-session 隔离、breaker
    交互与 metrics 透传。
  - `tests/http-transport/`：HTTP transport 契约，覆盖 routes 与 error mapping。
  - `tests/drivers/`：跨 backend driver 一致性，覆盖 banner map 与 reasoning 支持。
- `apps/<app>/tests/`：app 级测试，紧邻 `src/`：
  - `apps/web/tests/`：前端 app 测试，针对 i18n 契约。
  - `apps/server/tests/`：可测试的 runtime 单元，如端口探测。

新测试放入其所属目录。单 package 测试放入该 package 自己的 `tests/`；只有真正跨
多 package 的流程才放入根 `tests/` 的 journey 目录。

## app 层不测什么

listener 与 serve，即 `main` 与 `server`；信号处理；以及需要浏览器运行时的 Next.js
页面与组件。assembly root 只允许一个只读的启动冒烟测试
`apps/server/tests/assemble.test.ts`，它覆盖 health、sessions 与 meta，不启动任何
run，也不写入。业务逻辑属于 journey 测试。

## 单一职责

- 一个测试文件只测一件事。按 function、route domain 或 journey 拆分。
- 约 25 行以上的共享脚手架移入同目录的 support 模块，如 `*fixtures.ts` 与
  `mock-deps.ts`，不带 `.test` 后缀，使 runner 不会拾取它。
- 约 10 行以内的少量共享内容可以内联重复，使每个文件自包含。

```bash
pnpm test              # run the full suite
pnpm typecheck:tests   # typecheck tests only
```
