# 测试

> 语言：**简体中文** | [English](testing.md)

约定见 [tests/README.md](../../tests/README.md)。本页是操作地图：runner、解析机制，
以及什么在哪儿运行。

## 测试分层

1. leaf 测试位于 `packages/<family>/<leaf>/tests/`，紧邻 `src/`。leaf 测试只能引用
   其自身的 `../src/` 与公开 barrel。
2. journey 测试位于 `tests/<journey>/`，跨域，仅经 `@agentprism/*` 公开导出导入：
   - `tests/agent-execution/`：run 记账与 workspace 生命周期，横跨 `agent` 与
     `runtime`。
   - `tests/arena-runner/`：column-session 隔离、breaker 交互与 metrics 透传。
   - `tests/http-transport/`：请求契约，覆盖 routes、auth、error mapping、limits、
     settings 与 SSE 流，含 13 个测试文件与共享 `mock-deps.ts`。
3. app 测试：`apps/web/tests/` 覆盖 i18n catalog 对等、locale 解析与组件测试；
   `apps/server/tests/` 覆盖 `assemble`、`load-drivers`、`mount-routes` 与
   `portcheck`。

## 运行

```bash
pnpm test                  # one root vitest run for everything
pnpm test:coverage         # 同一次运行，覆盖率报告写入 cov-report/
pnpm smoke                 # 对运行中的服务做 HTTP 探测（见冒烟测试）
pnpm typecheck             # packages (build first) + apps + tests
pnpm typecheck:tests       # tsc -p tsconfig.tests.json --noEmit
pnpm verify                # build + typecheck + coverage + boundaries + check:deps
```

没有 per-package 测试脚本。根 `vitest.config.ts` 的 include 模式覆盖每个 leaf：
`tests/**/*.test.ts`、`packages/*/*/tests/**/*.test.{ts,tsx}` 与
`apps/*/tests/**/*.test.{ts,tsx}`。环境是 `node`。jsdom 风格的组件测试使用
testing-library 与所配置的环境。

## 覆盖率

`vitest.config.ts` 以 v8 provider 收集覆盖率，范围是 `packages/*/*/src` 与
`apps/*/src`，并排除纯 barrel（`index.ts`）、仅类型模块（`types.ts`）、测试脚手架，
以及 Next.js 保留的路由文件名（`page`、`layout`、`loading`、`error`、`not-found`、
`template`、`default`、`route`）。保留名属于框架挂载点而非本项目拥有的行为；
`apps/web/src/app` 下其余文件全部计入，并由 jsdom 与 testing-library 套件覆盖。
没有任何测试触达的文件同样计入，因此新模块无法在缺少对应测试的情况下进入代码树。
报告写入 `cov-report/`，包含文本表与 JSON 摘要。

覆盖率阈值在任何指标跌破启用时基线约四个百分点时使运行失败（启用时基线：
statements 87、branches 75、functions 88、lines 89）。该余量吸收运行间噪声，以及
Windows 参考平台无法触达的平台门控代码；同时让大范围回归变红，而不是任由覆盖率
无声下滑。覆盖率提升后应上调阈值；门禁变红的正确响应是补回测试，而非调低数字。

## 对外接口

`pnpm check:exports` 遍历每个 package 的 `src/index.ts`，把公开导出分为可调用与数据两
类；若某个可调用导出没有被任何测试脚手架文件引用，则失败。数据类导出（常量、schema、
enum）不设门禁：它们自身不携带行为。`scripts/check-export-tests.mjs` 里有一个
`PENDING` 列表，记录仍缺测试的可调用导出。该列表是待办清单，只允许缩短。

## 冒烟测试

`scripts/smoke.mjs` 对已在运行的服务做 HTTP 探测：先等待进程响应，再检查
`/health`、`/api/sessions` 与 `/api/arena/meta`。它只读，不启动任何 run，失败时以
非零退出并打印逐项结果。

```bash
pnpm smoke                                      # http://127.0.0.1:8281
SMOKE_BASE_URL=https://host.example pnpm smoke  # 任意已部署环境
SMOKE_PORT=8291 SMOKE_TIMEOUT_MS=60000 pnpm smoke
SMOKE_API_TOKEN=secret pnpm smoke               # 设置了 API_TOKEN 时
```

## CI

`.github/workflows/ci.yml` 运行在 `windows-latest`。`verify` job 覆盖 typecheck、
web lint、i18n 门禁、覆盖率、import 边界、依赖卫生与导出测试覆盖；`smoke` job 构建
宿主、启动 `apps/server/dist/main.js`，并对它运行冒烟探测。

Windows 是参考平台：受限令牌沙箱与 process-runner 套件仅适用于 Win32，换用其他
runner 会跳过与安全相关的用例。

## 名称解析

- Vitest alias 是生成的。根 `vitest.config.ts` 中的 `workspaceAliases()` 在配置加载
  时扫描 leaf 的 `package.json` 并把每个 `name` 映射到其 `src/`，新 package 无需
  编辑。这也是跨 leaf 测试引用不声明 devDependencies 的原因。
- Typecheck alias 是手工维护的。`tsconfig.tests.json` 每个 package 有一条显式
  `paths` 指向 `src/index.ts`，因为 TS5096 禁止多星号通配。新 package 必须加一行。
- 编辑器使用根 `tsconfig.json`，它继承 `tsconfig.tests.json`，使 `tests/` 下的文件
  无需编辑器专属配置即可解析 workspace import。没有任何构建或门禁脚本以 `-p` 使用
  它。

## 什么在哪儿固定行为

| 领域 | 由谁固定 |
|---|---|
| HTTP 契约：auth、limits、errors、SSE | `tests/http-transport/` |
| 组合装配 | `apps/server/tests/`。`mount-routes` 检查每 leaf 一个 endpoint；`load-drivers` 检查 registry 非空且含 `native` |
| i18n 完整性 | `apps/web/tests/catalog-parity.test.ts` 检查 en 与 zh-CN key 对等，以及 `pnpm --filter @agentprism/web check:i18n` |
| Driver banner 一致性 | driver-registry 的 banner 测试，覆盖全部 backend，以 `PIPELINE_BANNER_PREFIX` 为单一来源 |
| Toolset 成员 | contracts enums 与 tool-registry 测试 |
| Event 契约 | `contracts` 中的 zod schema 与 transport、journey 测试 |

## 约定

- 测试文件与其所拥有的代码就近放置。需要两个 package 内部的测试属于 journey 测试，
  只经公开 barrel。
- 时间经注入的 `Clock` 保持确定性；ID 经注入的 `IdGenerator` 保持确定性。套件测试
  不使用真实 sleep。
- 行为增量被显式固定。compaction 策略有单元测试固定相对 `sliding` 的增量。
- 完整门禁集为 `pnpm verify`：build、typecheck、覆盖率、import 边界、依赖卫生与对外
  导出的测试覆盖。
