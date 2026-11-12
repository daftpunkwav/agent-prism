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
  - `tests/gates/`：仓库门禁契约，锁定根门禁脚本与覆盖率配置，防止其已知绕过路径。
- `apps/<app>/tests/`：app 级测试，紧邻 `src/`：
  - `apps/web/tests/`：前端 app 测试——jsdom + testing-library 的页面、分区组件与
    hook 套件，外加 i18n 与 locale 契约。
  - `apps/server/tests/`：可测试的 runtime 单元，如端口探测。

新测试放入其所属目录。单 package 测试放入该 package 自己的 `tests/`；只有真正跨
多 package 的流程才放入根 `tests/` 的 journey 目录。

## app 层测什么

`apps/server/tests/` 在可读范围内覆盖宿主：启动冒烟（`assemble.test.ts`：health、
sessions、meta、builder 端点、arena 日志）、入口时序（`main.test.ts`：assemble →
startServer → 崩溃处理器 → signal handlers，外加停机顺序）、信号驱动的优雅停机
（`lifecycle.test.ts`）与端口预检。`apps/web/tests/` 存放页面、分区组件与 hook 的
jsdom + testing-library 套件。两层都不启动真实浏览器，也没有测试端到端驱动 UI；CI 的
`smoke` job 会启动构建后的宿主并做 HTTP 探测。业务逻辑仍属于 journey 测试。

## 单一职责

- 一个测试文件只测一件事。按 function、route domain 或 journey 拆分。
- 约 25 行以上的共享脚手架移入同目录的 support 模块，如 `*fixtures.ts` 与
  `mock-deps.ts`，不带 `.test` 后缀，使 runner 不会拾取它。
- 约 10 行以内的少量共享内容可以内联重复，使每个文件自包含。

```bash
pnpm test              # run the full suite
pnpm typecheck:tests   # typecheck tests only
```
