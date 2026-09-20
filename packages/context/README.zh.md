# context/

> 语言：**简体中文** | [English](README.md)

面向 prompt 与检索的独立 context 能力，拆成确定性 leaf：chunking 与 retrieval 为
harness 的 RAG 摄入供料，mentions 与 time 为 prompt 装配供料，analytics 跟踪 token
分布与策略有效性，budget 与 compaction 支撑 source-budget 与 checkpoint 策略，
instructions 加载仓库与 workspace 的 AGENTS.md 层。

注意：pipeline 内的 context 策略，如 sliding、tool_tail、token_budget、budget、
checkpoint 等，位于 `harness/context/*`；本 family 持有其下的可复用能力。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`context-chunking/`](context-chunking/README.md) | 面向检索摄入的结构感知分块，含 code、markdown、CJK-text 切分器与 metadata | harness `memory/rag.ts` |
| [`context-retrieval/`](context-retrieval/README.md) | 多信号检索：Okapi BM25、reciprocal-rank fusion、MMR 多样化、预算化内存索引 | harness `memory/rag.ts` |
| [`context-mentions/`](context-mentions/README.md) | `@file` 提及语法、遍历安全的 workspace 解析、候选搜索 | harness `prompt/assembly.ts` |
| [`context-time/`](context-time/README.md) | 经注入 clock 的 UTC 时间锚定、单调性守卫、按来源的 freshness 预算 | harness `prompt/prompt-builder.ts` |
| [`context-analytics/`](context-analytics/README.md) | Context 用量测量与策略有效性计数，用于 ablation grounding | harness `context/analytics.ts` 与 agent `agent-execution.ts` |
| [`context-budget/`](context-budget/README.md) | 按来源的 token 预算，含优先级分配与 `[Budget ledger]` 渲染 | harness `context/budget-strategy.ts`，即 `budget` 策略 |
| [`context-compaction/`](context-compaction/README.md) | checkpoint 式 compaction 信封，含 journal 与 undo，以及异步 summarizer port | harness `context/checkpoint-strategy.ts`，即 `checkpoint` 策略 |
| [`context-instructions/`](context-instructions/README.md) | 分层 agent 指令：仓库默认值与 workspace `AGENTS.md` 覆盖，带 digest 刷新 | harness `prompt/instructions.ts` 与 `prompt/assembly.ts` |

所有 leaf 都是纯的、确定性的：零依赖，或仅依赖 `contracts`，其中两个以结构性方式
接触文件系统；它们在依赖图中位于 `harness` 之下。
