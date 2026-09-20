# Package

> 语言：**简体中文** | [English](add-a-package.md)

拆分基于证据。当存在两个实现或两个真正不同的职责时才拆包，内聚的 leaf 保持在一起。
优先扩展现有 leaf，而非创建平行 leaf。

## Leaf 结构

新 leaf 位于 `packages/<family>/<leaf>/`。新的 family 目录还需要 family 的
`README.md` 角色表。单 leaf family 与名同名，如 `foo/foo`。

## package.json

`"name": "@agentprism/<leaf>"`、`"private": true`、`"type": "module"`、`exports` 指向
`./dist/index.js`、`files: ["dist"]`、`build` 与 `typecheck` 脚本，以及只与实际
import 相符的依赖。`pnpm check:deps` 会因过期、缺失或仅测试用的运行时声明而失败，
并建议把仅测试依赖降级为 `devDependencies`。

## tsconfig.json

在与同级 leaf 相同的深度 extend `../../tsconfig.base.json`。

## 源码

`src/index.ts` 是公开 barrel，保持最小。`import type` 边不计入依赖环，但计入声明
真实性。

## README.md

说明职责、seam 面与依赖方向，是 leaf 契约的一部分。

## 注册

- `pnpm-workspace.yaml` 无需改动，因为 `packages/*/*` 已覆盖该 leaf。运行
  `pnpm install` 建立链接。
- Vitest alias 从 leaf 的 `package.json` 生成。
- `tsconfig.tests.json` 需要一条手工 `paths` 条目：
  `"@agentprism/<leaf>": ["./packages/<family>/<leaf>/src/index.ts"]`，因为通配替换
  在 TS5096 下非法。

## 边界规则

参与受限方向的 leaf，如 plugins、routes、session family、context leaves、apps，
把其规则加入 `scripts/check-boundaries.mjs` 中的 `RULES` 数组。不受限的 leaf 仍会
被 `check:deps` 审计。

## 文档

该 leaf 加入 family `README.md` 表、`packages/README.md`，以及
[../architecture.zh.md](../architecture.zh.md) 的 family 映射。用户可见概念还加入
[../architecture/overview.zh.md](../architecture/overview.zh.md)。

## 何时不要拆包

- 单个函数或 ToolDefinition 属于现有 leaf。
- 内聚的子目录保持不拆，如 `harness` 与 `contracts`。
- 尚不存在的第二种交付形态不需要新 package，组合根因此留在 `apps/server`。
