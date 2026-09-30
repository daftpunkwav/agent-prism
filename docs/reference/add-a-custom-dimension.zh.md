# 新增自定义对比维度

一个自定义对比维度**就是 `packages/custom/<名字>` 下的一个包**。包内声明该维度可取的
值以及取值如何生效；在组合根注册后，它会自动成为：

- **Arena 的一条对比轴**——独立的维度卡片、lane、基线字段、事件、报文、日志与报告
  （走完整管道，没有任何特判）；
- **Builder 的一个积木块**——面板里的一个槽位，随会话保存，可热切换；
- **基线面板的一个可钉字段**——`custom.<id>`，因此可以在对比其他轴时把它固定住。

以上都不需要改前端代码。

```
packages/custom/summary-budget/        一个维度 = 一个包
  README.md                            对比什么、用哪个钩子
  package.json                         @agentprism/<name>，依赖 contracts
  src/index.ts                         导出一个 CustomDimension 描述符
  tests/                               该维度自己的测试
```

仓库自带三个示例：`summary-budget`（`contextTuning` 钩子）、`memory-top-n`（`memory` 钩子）、
`tool-replay`（`messages` 钩子）。

## 描述符

```ts
import type { CustomDimension } from "@agentprism/contracts";

export const myDimension: CustomDimension = {
  id: "my_dimension",                       // lower_snake_case；轴 id + Builder 积木块 custom:my_dimension
  label: "My dimension",                    // 英文规范名；有 i18n 键时前端会覆盖
  subtitle: "Arena 卡片上的一行说明",
  options: [
    { value: "a", label: "A", description: "a 的含义" },
    { value: "b", label: "B" },
  ],
  default: "a",                             // 必须是 options 之一（缺省取第一项）
  promptHint: "\n[Context: my dimension = {value}]",   // {value} 会被替换
  hooks: { /* 见下 */ },
};
```

没有钩子的描述符也是合法的：此时该列与其他列只差一行 prompt 标记。

`default` 是没有其他覆盖时的生效取值：Builder 会高亮它，从未改动该积木的 Builder 组合
也以它为运行值，Arena 基线面板把它作为 `custom.<id>` 字段的默认值提供。Builder 的显式
选择或基线钉值优先；省略 `default` 则回落到第一项。

## 四个钩子

每个槽位都对应运行管道中一个**既有**接缝。钩子是纯函数式的塑形，只操作框架中立的值——
不碰厂商 SDK、不做 IO、不读环境时钟（同一维度必须在所有列上行为一致）。

| 钩子 | 运行时机 | 覆盖范围 | 适合做什么 |
|---|---|---|---|
| `contextTuning(value, base)` | 运行装配期，在 context 策略之前 | 所有应用共享上下文管道的 driver | 调整某个策略自己的预算（摘要 digest 上限、窗口、token 池） |
| `messages(input, value)` | context 策略之后、pair-safety/sanitize/grounding 之前 | 同上 | 模型看到哪些/多少历史；屏蔽 tool 输出 |
| `prompt(input, value)` | prompt 组装末尾，作用于已合成的 system/user | **全部框架** | 增加、改写或剥离 prompt 文本（接地行、策略文案） |
| `memory(input, value)` | prompt 组装期，在记忆块渲染之前 | **全部框架** | 挂载多少条召回记忆、挂载哪些 |

两个需要知道的推论：

- `prompt` 与 `memory` 也能覆盖 `openai_agents` 与 `claude_agent_sdk`（这两个 driver 也
  组装 prompt，但自持循环）。`contextTuning` 与 `messages` 不覆盖：在那两列上，消息级
  维度是空操作，列间不会有差异。这是事实行为而非 bug——对比结果"全平"时请引用这一点。
  同一边界也适用于内置 `context` 维度本身（那两个 driver 从不调用共享 context 管道），
  因此无论自定义策略式维度还是内置 context 策略，在那两列上都隔离不出任何东西。
- `messages` 可以删除结果：共享的 pair-safety 会连带丢弃失去结果的 tool 调用。若希望保留
  调用可见，请把结果替换为标记。

钩子按**注册顺序**折叠；钩子返回 `undefined`（或空补丁）表示不改动。

## 配方

1. **创建包**（`packages/custom/<名字>`，复制一个自带示例）：

   ```jsonc
   // package.json
   { "name": "@agentprism/<name>", "type": "module", "private": true,
     "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
     "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit" },
     "dependencies": { "@agentprism/contracts": "workspace:*" } }
   ```

   外加标准的 leaf `tsconfig.json`（extends `../../../tsconfig.base.json`）。

2. **导出描述符**（`src/index.ts`，见上）。

3. **注册**到 `apps/server/src/assemble.ts`：

   ```ts
   registerCustomDimensions([...existing, myDimension]);
   ```

   并在 `apps/server/package.json` 添加 `"@agentprism/<name>": "workspace:*"`。
   注册由 `ARENA_CUSTOM_DIMENSIONS=off` 统一开关。

4. **`pnpm install`**、重新构建、重启。`pnpm typecheck` 与
   `node scripts/check-boundaries.mjs` 必须保持绿色。

5. **写 README**（英文 + `.zh.md`，与自带示例一致）：对比什么、取值表、用哪个钩子、有哪
   些限制。每个自定义维度自带文档，下一个读者无需翻遍框架代码。

## 约束与失败模式

- **id 文法**：`^[a-z][a-z0-9_]{0,63}$`。注册会拒绝：首尾空白的 id、空 label、空或重复
  的选项、超过 200 字符的选项取值（每个持久化 config 记录的上限）、`default` 不在
  `options` 内、与内置维度或内置 context 策略撞 id（否则该维度的 effectiveness 行会与那条
  策略的行合并）、第二个包抢占已注册 id——全部在启动期报错，绝不推迟到运行期。
  run、baseline、builder 三个 wire schema 的 `custom` 映射用同一正则校验键，键不可能
  来自已注册维度的请求在解析期即以 `422` 拒绝。
- **未知 id 在三处 fail-loud**：配置期（Builder 组合）、基线解析（钉了一个没有包提供的
  维度）、运行装配（存储的 thread 对应的包已被移除）。任何一处都不会静默跑成"其实是另一
  个实验"。
- **取值按实时注册表校验**：Builder 与基线都会校验；run 请求接受任意轴 token，由 router 在
  开流之前以 `422` 拒绝未知轴。
- **thread 与 Builder 组合**与其他积木一样携带自定义取值（`PipelineConfig.custom`），因此
  随会话在重启后依然有效。
- **标签本地化**：没有前端 catalog 键时展示英文 `label`（与其他动态选项同样的兜底）。需要
  翻译就往 `apps/web/src/i18n/catalogs/*/dimensions.ts` 补
  `dimensions.field.<id>` / `dimensions.opt.<id>.<value>` 键。
- **应用内指南**（`/guide`）只记录 16 个内置维度；自定义维度由它自己的包 README 记录。

## 关闭自定义维度

在环境（或根 `.env`）设置 `ARENA_CUSTOM_DIMENSIONS=off`：不再注册任何维度，也不产出任何
投影行，Arena 回落到仅内置轴。此前钉过自定义值的配置随后会 fail-loud（见上），而不是静默
丢弃该取值继续运行。

## 相关文档

- `docs/reference/dimensions.zh.md`——内置维度及其选项来源。
- `docs/guides/add-a-dimension.zh.md`——新增一个**顶层内置**维度（enum + 字段 + driver），
  那是另一类、大得多的改动。
