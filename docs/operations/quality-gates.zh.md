# 质量门禁

> 语言：**简体中文** | [English](quality-gates.md)

所有门禁都是普通 npm script。仓库中未接入任何 pre-commit hook。手动或 CI 运行它们。
标准的全量扫描为：

```bash
pnpm verify    # 构建 + typecheck + coverage + boundaries + check:deps + check:exports
pnpm --filter @agentprism/web lint         # web ESLint，改动 UI 代码后运行
pnpm --filter @agentprism/web check:i18n   # web i18n 门禁，改动前端文案后运行
```

## 门禁

| 门禁 | 脚本 | 负责 | 失败意味着 |
|---|---|---|---|
| 方向 | `pnpm boundaries`，来自 `scripts/check-boundaries.mjs` | package 之间的 import 方向，通过对每条规则 roots 下的 ts 与 tsx 文件做 regex 行扫描检查 | 某 import 违反方向规则，如 `contracts` 导入任何 `@agentprism/*`、plugin 导入 composer、`apps/web` 导入 client、ui、arena-view 之外的任何东西 |
| 真实性 | `pnpm check:deps`，来自 `scripts/check-package-deps.mjs` | 声明与实际：未声明的值 import、仅类型 import、未使用的已声明依赖、value-edge 环，仅类型边忽略 | 过期或缺失的声明，或仅测试使用的运行时依赖，会告警并建议降级为 devDependencies |
| 测试 | `pnpm test`，根 vitest | 行为 | 任何套件失败 |
| 类型 | `pnpm typecheck` | 全仓库类型安全 | 类型错误；先构建 package，使跨 package 解析保持新鲜 |
| Lint | `pnpm --filter @agentprism/web lint`，ESLint 9 flat config 位于 `apps/web/eslint.config.mjs` | web app 的 lint 纪律（Next.js core-web-vitals 与 typescript 规则） | 一个 ESLint error；warning 仅为提示，任何规则豁免都在配置内注明原因 |
| 导出测试覆盖 | `pnpm check:exports`，来自 `scripts/check-export-tests.mjs` | 每个可调用的公共导出都被测试 harness 文件引用 | 存在无测试引用的可调用公共导出——删除它或为它补测试 |
| i18n | `pnpm --filter @agentprism/web check:i18n`，来自 `apps/web/scripts/check-i18n.mjs` | UI 文案纪律 | en 与 zh-CN catalog key 对等失败，或在 `src/app`、`src/components` 中发现内联 CJK；注释与 `console.*` 被剥离，标有 `i18n-exempt` 的行被跳过 |

方向规则列于 `scripts/check-boundaries.mjs` 的 `RULES` 数组，它是唯一事实来源。要点
不变量为：`contracts` 是零依赖 leaf；drivers、tools、providers 等 plugin 绝不向上
触达 composer 或 providers；transport shell 绝不反向依赖 routes；`apps/web` 只依赖
`client`、`ui`、`arena-view`。

## 门禁假定的约定

- Conventional Commits，形式为 `<type>: <subject>`，type 为 `feat`、`fix`、`docs`、
  `refactor`、`chore`、`test` 或 `perf`。subject 为祈使式且至多 50 字符，每个 commit
  一个关注点。分支为 `<type>/<kebab-case>`。规则定义于 workspace 的 `AGENTS.md`。
- 语言策略：代码与注释为英文。文档提供英文与简体中文两个版本。用户可见的 UI 文案
  放在 i18n catalog，以 `en` 为规范 locale、`zh-CN` 为镜像，绝不内联。
- Leaf README 契约：每个 package README 都说明职责、seam 面与依赖方向，在 review 层
  强制。
- 文档层级：`docs/` 镜像代码，绝不能与之矛盾。若冲突，以代码与
  `scripts/check-boundaries.mjs` 为准。

## 与门禁相邻的改动

- 新 package 很可能需要一条 `boundaries` 规则。见
  [../guides/add-a-package.zh.md](../guides/add-a-package.zh.md)。
- 新 endpoint 扩展匹配的 `tests/http-transport/` 文件。每 leaf 一个 endpoint 由
  `mount-routes.test.ts` 固定。
- 新 UI 文案需要在两个 locale 的 catalog，并使 `check:i18n` 通过。
