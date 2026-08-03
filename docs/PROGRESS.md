# AgentPrism 开发进度报告

> 本文档面向**当前实现**撰写。每个声明都对应 `backend/app/`、`frontend/src/` 或 `tests/` 下的实际代码；与早期 PRD/README 不一致时，**以本文档为准**。
> 数据截止：2026-08-04（HEAD `ad1c07f`；共享多轮对话 + 按轮 Trace；学习路径扩至八周；Vercel 风格 UI）。

---

## 1. 一句话总览

AgentPrism 是一个 **Agent 对比实验台**：用户提一个问题，2～4 条 Agent 管线并行运行，差异通过流式 Trace + 硬指标报告实时可见。各列可**共享对话历史**续聊，Trace / TraceDiff 按 `turn` 分段对比。

**已实现 5 个对比维度**（`framework` / `prompt` / `reasoning` / `context` / `harness`），每条管线共用同一份 Tool 集与 LLM 客户端，通过 `PipelineConfig` 切换维度下的变量。多轮是**对比形态**（共享 `messages`），不是新的 Pipeline 维度。

**技术栈实际状态**：

| 层 | 实现 |
|---|---|
| 前端 | Next.js 16.2.10 + React 19.2.4 + TypeScript 5.9 + Tailwind v4 |
| 后端 | FastAPI + Pydantic v2 + sse-starlette（`lifespan` 已迁移） |
| LLM | LangChain `ChatAnthropic` / `ChatOpenAI`，BYOK（`data/provider_config.json`） |
| 推理 | LangGraph `StateGraph`（ReAct / CoT+Tool / ToT / Reflexion 四张图） |
| 数据 | 文件级 JSON（`provider_config.json` + `projects.json`），**无 SQL/ORM**；原子写见 `storage.py` |
| 前端状态 | 仅 `useState` / `useReducer` / `useRef`，无 Zustand/Redux |
| 任务模板 | `arena/templates.py` 8 个预置模板 + `arena/judging.py` 确定性判分器（无 LLM） |
| 多轮 | `ArenaRunRequest.messages` + 适配器 `history=`；前端 `chatHistory`；事件带 `turn` |
| 学习路径 | `/learn` 8 周引导页，一键预填 Arena（URL 参数）；`/guide` 维度与多轮说明 |
| 测试 | 仓库根 `tests/`，**37 个文件 / 344 个 `test_` 函数**（CI：ruff + mypy + pytest） |

---

## 2. 实现了什么

### 2.1 后端核心（`backend/app/`）

| 模块 | 文件 | 关键能力 |
|---|---|---|
| 入口 | `main.py` | `lifespan`；CORS；10MB 请求体限制；第三方 logger 降级 WARNING |
| 配置 | `config.py` | `Settings`（env）+ `ProviderConfig`（JSON），经 `storage` 原子写 |
| 存储 | `storage.py` | `_atomic_write_json`（tmp → fsync → bak → replace） |
| 模型 | `models.py` | `PipelineConfig` / `ArenaRunRequest`（含 `messages`） / `ChatMessage` / `ArenaEvent`（含 `turn`） / `PipelineMetrics` / `ProviderConfig*` / `Project*` |
| 类型 | `arena/types.py` | Literal 单一来源（DimensionId / PromptProfile / ReasoningMode / ContextStrategy / HarnessLevel / ApiFormat / EventType） |
| 路由 | `arena/router.py` | `DimensionRouter.route()`；`@lru_cache` provider；`invalidate_provider_cache` |
| 池 | `arena/runner.py` | `RunnerPool` 合并 2～4 路 SSE；断开取消 worker；失败补发 `complete`；错误脱敏 |
| 适配器 | `adapters/{base,langchain_adapter,langgraph_adapter,common}.py` | Protocol + Registry；LangChain `create_agent` / LangGraph StateGraph |
| 推理图 | `arena/reasoning_graph.py` | ReAct / CoT+Tool / ToT / Reflexion 四张图 |
| 推理 Prompt | `arena/reasoning.py` | 4 模式 System/User 后缀 |
| Prompt | `arena/prompts.py` | 4 Profile；`build_messages` 注入推理/Harness/上下文 |
| 上下文 | `arena/context_manager.py` + `arena/rag.py` | sliding / summary / hybrid + TF-IDF 向量；Workspace 惰性 RAG 缓存 |
| Harness | `arena/harness.py` | `astream_events` 拦截；verify / reflect / propose_harness_edit；prompt 注入脱敏 |
| 工具 | `arena/tools.py` | **11 个 tool**（含独立进程 `run_code` 沙箱） |
| 工具守卫 | `arena/tool_guard.py` | `assess_tool_relevance` 拦截跑题 tool_calls |
| 消息消毒 | `arena/message_sanitize.py` | strip thinking/tool_use + 任务锚定 |
| 错误脱敏 | `arena/errors.py` | `sanitize_error_message`（仅异常类型名） |
| 模板 | `arena/templates.py` | 8 个预置可判分模板 |
| 判分 | `arena/judging.py` | keyword / json / code / numeric / exclude / regex |
| 工作空间 | `arena/workspace.py` | 路径规范化；TTL 1h + LRU 32 + 锁；运行中保护 |
| LLM | `arena/llm.py` | 按 `api_format` 选客户端；`_pipeline_overrides` ContextVar |
| Token | `arena/token_utils.py` | API 用量回退估算 |
| 流式 | `arena/stream_utils.py` | 统一 chunk 文本提取 |
| 项目 | `arena/project.py` | 原子写；精确 `workspace_names`；落盘失败抛错 |
| API | `api/arena.py` | `/meta` `/run` `/templates` `/judge` `/workspace/...` `/projects` |
| API | `api/settings.py` | `/api/settings/provider` GET/PUT + `/test` |

### 2.2 前端（`frontend/src/`）

| 组件 / 页面 | 能力 |
|---|---|
| `AppShell.tsx` | 导航：`/arena` `/guide` `/learn` `/projects` `/settings` + ThemeToggle |
| `learn/page.tsx` | 8 周学习路径（含多轮续聊），每步链到 Arena URL 预填 |
| `guide/` | 维度说明 + 多轮 / 对比形态文档 |
| `ArenaClient.tsx` | 维度切换 + 模板/判分 + 共享多轮 + 三 Tab + 保存为项目 |
| `TraceView.tsx` | `thought_delta` 归并 + Markdown；多轮按 turn 分段 |
| `TraceDiff.tsx` | step / turn 对齐差异；长文本「展开/收起」 |
| `WorkspacePanel.tsx` | 文件树 + 预览/编辑；polling + AbortController |
| `ExperimentPanel.tsx` | 采样参数滑块；单一 `flushParams` PUT |
| `TokenStatsPanel.tsx` | compact / full 两态 |
| `error.tsx` / `global-error.tsx` | 路由级 / 全局错误边界 |
| `lib/api.ts` | API 函数；`streamArenaRun(..., messages?)`；ArenaEvent discriminated union |

### 2.3 测试（`tests/`）

**37 个测试文件 / 344 个 `test_` 函数**（AST 统计；以 `PYTHONPATH=backend pytest tests/ -v` 为准）。

| 文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `test_tool_security.py` | 33 | calculate / run_code AST 与沙箱边界 |
| `test_harness_runner.py` | 27 | Harness 重试循环、stream_events |
| `test_sandbox_security.py` | 24 | 沙箱逃逸回归 |
| `test_judging.py` | 19 | 六种判分类型 |
| `test_validation.py` | 14 | 请求/模型校验 |
| `test_rag.py` | 10 | TF-IDF / ContextRetriever |
| `test_reasoning_harness.py` | 10 | 推理图 + Harness |
| `test_registry_extended.py` | 10 | Adapter 热插拔 |
| `test_message_sanitize.py` | 10 | 消息消毒 + tool_guard |
| `test_token_utils.py` | 9 | TokenTracker |
| `test_templates.py` | 9 | 模板库完整性 |
| `test_workspace_manager.py` | 9 | TTL / LRU |
| `test_frontend_session_contracts.py` | 9 | 前后端契约（含模板/判分） |
| `test_project_manager.py` | 9 | 项目落盘 / 回滚 |
| `test_llm_factory.py` | 6 | LLM 工厂 |
| `test_agent_state_context.py` | 6 | ContextVar / AgentState |
| `test_reasoning_graphs.py` | 6 | 四图编译 |
| `test_stream_utils.py` | 6 | chunk 解析 |
| `test_router.py` | 6 | DimensionRouter |
| `test_llm_overrides.py` | 5 | pipeline overrides |
| `test_reasoning_graph_fixes.py` | 5 | graph 回归 |
| `test_baseline_overrides.py` | 4 | 基线覆盖 |
| `test_prompts_context.py` | 4 | 上下文注入 |
| `test_registry.py` | 4 | 基础注册 |
| `test_prompts.py` | 3 | Prompt profiles |
| `test_request_size_middleware.py` | 3 | 10MB 限制 |
| `test_runner.py` | 3 | 取消 / 错误脱敏 |
| `test_project_create.py` | 3 | create_from_run |
| `test_workspace_api.py` | 2 | Workspace 文件 API |

### 2.4 CI

`.github/workflows/ci.yml`：
- **backend-test**：`pip install -e ".[dev]"` + `ruff check app/` + `mypy app/ --ignore-missing-imports` + `PYTHONPATH=backend pytest tests/ -v` + collect-only 统计
- **frontend-build**：`npm ci` + `npx tsc --noEmit` + `npm run build`

### 2.5 数据持久化

- `data/provider_config.json`：BYOK 配置（脱敏 API Key、采样参数等）
- `data/projects.json`：项目列表
- 均经 `storage._atomic_write_json`（tmp → bak → rename）

---

## 3. 怎么实现的（关键技术决策）

### 3.1 控制变量法 — `PipelineConfig`

`DimensionRouter.route(dimension, selections)` 只变对比维度字段；其余用 `DEFAULT_BASE`（框架=langgraph、推理=react、上下文=sliding、Harness=bare、Prompt=zero_shot、`prompt_version="v1.0.0"`）。

### 3.2 并行执行 — `RunnerPool.stream_parallel`

`asyncio.Queue` 合并多路事件；`CancelledError` 时取消 worker → `gather(..., return_exceptions=True)` → 再 raise。对外错误走 `sanitize_error_message`。

### 3.3 工作空间隔离 — `contextvars.ContextVar`

异步栈感知；工具经 `_get_ws()` 取当前 workspace。名称带 UUID 短后缀，避免同 label 覆盖。

### 3.4 Tool 沙箱 — 独立进程 + AST

`run_code`：`spawn` 子进程、AST 阻断 dunder/import、超时 terminate/kill、Semaphore(4)、输出截断。`calculate`：AST 白名单 + 大指数拦截。

### 3.5 任务模板 + 判分

模板携带 `JudgeSpec`；前端跑完后调用 `/judge`。判分纯函数、确定性，不做语义判断（语义属 Harness L3）。

### 3.6 Harness 循环 — `astream_events` 拦截

注入 `_harness: True` 控制事件；`verify_result` 解析失败默认未通过。

### 3.7 上下文策略

`vector` 在 Prompt 层注入 TF-IDF top-3（Workspace 惰性缓存）；其余走 `ContextManager`。

### 3.8 Trace 流式渲染

`TraceView.mergeEvents` 用稳定 key 归并 `thought_delta`；`thought_end` 切完整 Markdown。

### 3.9 共享多轮 — `messages` + `turn`

`ArenaRunRequest.messages` 成对校验；适配器 `build_initial_lc_messages`；runner 戳 `turn`；worker 失败补发 `complete`。前端 `chatHistory` 跨列共享；重试/取消/系统错误剥离本轮 events，保留更早轮。

---

## 4. 修改意见（已知遗留问题与改进点）

> ✅ = 已在近期分支解决；其余按优先级保留。

### 4.1 高优先级（多数已关闭）

1. **测试运行数不一致** ✅ — CI collect-only；文档以 37/344 为准（2026-08-04 复测）
2. **`is_mvp_ready` 死代码** ✅ — 已删
3. **`SimpleVectorStore` 每次重建** ✅ — Workspace `rag_store()` 惰性缓存
4. **API Key SSE 泄漏** ✅ — `sanitize_error_message`
5. **Project 落盘失败仍 200** ✅ — 抛错 + HTTP 500
6. **前端无 ErrorBoundary** ✅ — `error.tsx` + `global-error.tsx`
7. **ExperimentPanel 多 PUT** ✅ — 单一 `flushParams`
8. **CI 无 mypy** ✅ — 硬性门槛，`app/` 零错误

### 4.2 中优先级（仍开放）

4. **Workspace TTL=1h** — 已保存项目不受影响；LRU 保护运行中项 ✅
5. **`on_node_start` 黑名单耦合** — 低影响，未处理
6. **`_pipeline_overrides` 取消路径** ✅ — ContextVar finally 测试覆盖
7. **TraceDiff 300 字符截断** ✅ — 可展开全文
8. **同步 `llm.invoke` 阻塞事件循环** — `reasoning_graph` / `harness` 仍同步调用
9. **`_atomic_write_json` 无跨进程文件锁** — 有原子写/备份，无 flock
10. **ArenaClient 巨型组件** — 仍约 1200+ 行，待拆分
11. **前端无单元测试 / 无 SSE E2E** — 仍开放
12. **`column-status-dot` 仅靠颜色** — ARIA 未补全

### 4.3 低优先级

8. **前端无 i18n** — 暂缓
9. **任务模板库** ✅ — Phase 9
10. **`openai_chat` Provider** — Settings 高级选项已提示
11. **pre-commit 与 ruff 行长 160** — 保持一致
12. **学习路径 UI** ✅ — Phase 8（已扩至八周，含多轮）

详见 [`CODE_REVIEW.md`](./CODE_REVIEW.md) 修复状态附录。

---

## 5. 路线图（基于现状的修订）

| 阶段 | 目标 | 状态 |
|---|---|---|
| Phase 1-5 | 5 维度 + 对比报告 + Trace + Workspace + 项目 + 安全硬化 | ✅ |
| Phase 8 | 学习路径引导 UI（`/learn`，现 8 周） | ✅ |
| Phase 9 | 任务模板库 + 确定性判分器 | ✅ |
| Phase 11 | CI mypy 硬性门槛 | ✅ |
| 多轮形态 | 共享 `messages` + 按轮 Trace / TraceDiff（非新维度） | ✅ |
| UI 重设计 | Vercel 风格 token + Arena 配置/运行条 | ✅ |
| Phase 6 | AutoGen / CrewAI Adapter（Python 3.14 暂不可装） | ⏳ |
| Phase 7 | MCP 集成 | 📝 规划 |
| Phase 10 | Harness Lab（YAML Primitive 编辑器） | 📝 规划 |
| 后续 | Node/OS 矩阵、前端 vitest、SSE E2E、文件锁、异步 LLM | ⏳ |

---

## 6. 重要事实速查

- **前端框架**：Next.js 16.2.10。⚠️ 写代码前读 `frontend/AGENTS.md` + `node_modules/next/dist/docs/`
- **默认 Provider**：StepFun（`anthropic_messages`），Base URL `https://api.stepfun.com/step_plan`
- **默认模型**：`step-3.7-flash`
- **页面**：`/arena` `/guide` `/learn` `/projects` `/settings`
- **多轮 API**：`POST /api/arena/run` 可选 `messages`（user/assistant 成对，合计含本轮问题 ≤24000 字符）
- **模板 API**：`GET /api/arena/templates`、`POST /api/arena/judge`
- **跑测试**：`PYTHONPATH=backend pytest tests/ -v` → **37 文件 / 344 函数**
- **lint / 类型**：`ruff check app/`、`mypy app/ --ignore-missing-imports`
- **workspace**：最多 32；空闲 > 1h 回收；LRU 保护运行中
- **run_code 超时**：1~10s，超时 terminate + kill
- **请求体上限**：10MB → 413
