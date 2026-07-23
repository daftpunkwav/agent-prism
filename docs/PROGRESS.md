# AgentPrism 开发进度报告

> 本文档面向**当前实现**撰写。每个声明都对应 `backend/app/`、`frontend/src/` 或 `tests/` 下的实际代码；与早期 PRD/README 不一致时，**以本文档为准**。
> 数据截止：2026-07-23（最近一次 commit `05f59da chore(ci): 根目录 pytest tests/ + 声明 langchain-openai`）。

---

## 1. 一句话总览

AgentPrism 是一个 **Agent 对比实验台**：用户提一个问题，2～4 条 Agent 管线并行运行，差异通过流式 Trace + 硬指标报告实时可见。

**已实现 5 个对比维度**（`framework` / `prompt` / `reasoning` / `context` / `harness`），每条管线共用同一份 Tool 集与 LLM 客户端，通过 `PipelineConfig` 切换维度下的变量。

**技术栈实际状态**：

| 层 | 实现 |
|---|---|
| 前端 | Next.js 16.2.10 + React 19.2.4 + TypeScript 5.9 + Tailwind v4 |
| 后端 | FastAPI + Pydantic v2 + sse-starlette（`lifespan` 已迁移） |
| LLM | LangChain `ChatAnthropic` / `ChatOpenAI`，BYOK（`data/provider_config.json`） |
| 推理 | LangGraph `StateGraph`（ReAct / CoT+Tool / ToT / Reflexion 四张图） |
| 数据 | 文件级 JSON（`provider_config.json` + `projects.json`），**无 SQL/ORM** |
| 前端状态 | 仅 `useState` / `useReducer` / `useRef`，无 Zustand/Redux |
| 测试 | 仓库根 `tests/`，**20 个文件 / 146 个 `test_` 函数** |

---

## 2. 实现了什么

### 2.1 后端核心（`backend/app/`）

| 模块 | 文件 | 关键能力 |
|---|---|---|
| 入口 | `main.py` | `lifespan` 替代 `on_event`；CORS；10MB 请求体限制中间件；非法 Content-Length 返回 400 |
| 配置 | `config.py` | `Settings`（env）+ `ProviderConfig`（JSON），原子写 + `.bak` 备份 |
| 模型 | `models.py` | `PipelineConfig` / `ArenaRunRequest` / `ArenaEvent` / `PipelineMetrics` / `ProviderConfig*` / `Project*` |
| 类型 | `arena/types.py` | 6 个 Literal 单一来源（DimensionId / PromptProfile / ReasoningMode / ContextStrategy / HarnessLevel / ApiFormat / EventType） |
| 路由 | `arena/router.py` | `DimensionRouter.route()` 生成 configs；`@lru_cache` 缓存 provider 配置；Provider 更新时 `invalidate_provider_cache` |
| 池 | `arena/runner.py` | `RunnerPool` 通过 `asyncio.Queue` 合并 2～4 路 SSE；客户端断开 `CancelledError` 取消所有 worker |
| 适配器 | `adapters/{base,langchain_adapter,langgraph_adapter,common}.py` | `FrameworkAdapter` Protocol + Registry + 热插拔监听器；LangChain 用 `create_agent`，LangGraph 用真实 StateGraph |
| 推理图 | `arena/reasoning_graph.py` | `build_react_graph` / `build_cot_tool_graph` / `build_tot_graph` / `build_reflexion_graph` |
| 推理 Prompt | `arena/reasoning.py` | 4 个模式 → System/User 后缀；`get_reasoning_description` 复用 |
| Prompt | `arena/prompts.py` | 4 个 Profile（zero_shot / few_shot / cot_prompt / structured）；`build_messages` 注入推理/Harness/上下文 |
| 上下文 | `arena/context_manager.py` + `arena/rag.py` | `ContextManager`（sliding / summary / hybrid）+ `SimpleVectorStore`（TF-IDF + 余弦相似度）+ `ContextRetriever`（混合策略） |
| Harness | `arena/harness.py` | `HarnessRunner.stream_events` 走 `astream_events`；`verify_result` / `reflect_on_failure` / `propose_harness_edit` 三个 LLM 调用；`_sanitize_for_json` 抗 prompt 注入 |
| 工具 | `arena/tools.py` | **11 个 tool**：get_current_time / calculate / write_file / create_file / append_file / read_file / list_files / file_tree / delete_file / run_code（独立进程沙箱）/ summarize_text |
| 工作空间 | `arena/workspace.py` | `Workspace`（路径规范化拒绝绝对路径/../`./`/控制字符）；`WorkspaceManager`（**TTL 1 小时 + LRU 32 上限 + 线程锁**） |
| LLM | `arena/llm.py` | `create_chat_model` 按 `api_format` 选 Anthropic / OpenAI；`_pipeline_overrides` 通过 `ContextVar` 让 pipeline 级覆盖 |
| Token | `arena/token_utils.py` | `TokenTracker`（带 API 用量回退到估算）；`extract_usage` 兼容 LangChain `usage_metadata` 与 OpenAI 风格 |
| 流式 | `arena/stream_utils.py` | `extract_chunk_text` 统一 dict / .content / .text 入口；识别 `thinking` 块 |
| 项目 | `arena/project.py` | `ProjectManager` 原子写；`_generate_project_id` 用 UUID+时间戳避免冲突 |
| API | `api/arena.py` | `/meta` `/run` `/workspace/{name}/{files,file}` `/projects`（GET/POST/DELETE） |
| API | `api/settings.py` | `/api/settings/provider` GET/PUT + `/test`，**API Key 脱敏 + 错误类型脱敏** |

### 2.2 前端（`frontend/src/`）

| 组件 | 能力 |
|---|---|
| `AppShell.tsx` | 顶部导航（`/arena` `/projects` `/settings`）+ ThemeToggle |
| `ArenaClient.tsx` | Arena 主页面：维度切换 + chip 多选 + 三 Tab（输出结果 / 对比报告 / Trace 对比） + 跑前确认 + 跑后「保存为项目」 |
| `TraceView.tsx` | 实时归并 `thought_delta` → Markdown 渲染（`react-markdown` + `remark-gfm`）；按 step 累积；自动滚到底 |
| `TraceDiff.tsx` | 按 step 对齐各列事件，标记差异（类型不一致 / 内容不一致） |
| `WorkspacePanel.tsx` | 文件树（嵌套目录可展开）+ 预览/编辑 + 新建/删除；polling 间隔运行中 1.5s / 闲置 5s；AbortController 取消切换 |
| `ExperimentPanel.tsx` | 5 个采样参数滑块（Temperature / Top P / Frequency / Presence / Max Tokens）；`onPointerUp` 统一提交（避免长按方向键反复 PUT） |
| `TokenStatsPanel.tsx` | compact / full 两态；显示输入 / 输出 / 总计 + 上下文 / 输入占比双进度条 |
| `lib/api.ts` | 12 个 API 函数；SSE 客户端带 `AbortSignal` 与 `data:` 行解析 |

### 2.3 测试（`tests/`）

**20 个测试文件 / 146 个 `test_` 函数**（含类内缩进测试）。

| 文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `test_harness_runner.py` | 15 | `HarnessRunner` bare/verify/reflect/self_evolve 重试循环、`_pick_final_state`、`stream_events` |
| `test_tool_security.py` | 15 | `_safe_calculate` AST 白名单、`run_code` AST 阻断（import / dunder / `__import__` 等） |
| `test_rag.py` | 10 | `SimpleVectorStore` TF-IDF + 余弦、`chunk_text`、`ContextRetriever` 4 种策略 |
| `test_reasoning_harness.py` | 10 | 推理图 + Harness 联合 |
| `test_registry_extended.py` | 10 | Adapter Registry 热插拔 |
| `test_token_utils.py` | 9 | `TokenTracker` 用量回退 + 估算路径 |
| `test_workspace_manager.py` | 7 | TTL / LRU / 锁 / remove |
| `test_reasoning_graphs.py` | 6 | 4 张图编译 + 节点结构 |
| `test_stream_utils.py` | 5 | 多 provider chunk 格式（dict / content 列表 / thinking） |
| `test_router.py` | 5 | `DimensionRouter.route` + `selections` |
| `test_frontend_session_contracts.py` | 5 | API → 前端类型契约 |
| `test_reasoning_graph_fixes.py` | 4 | 旧版 graph bug 回归 |
| `test_prompts_context.py` | 4 | `build_messages` 上下文注入 |
| `test_prompts.py` | 3 | 4 个 Profile |
| `test_registry.py` | 4 | 基础注册/查询/异常 |
| `test_llm_overrides.py` | 3 | `_pipeline_overrides` ContextVar 隔离 |
| `test_request_size_middleware.py` | 3 | 10MB 上限 + 非法 Content-Length |
| `test_project_create.py` | 2 | Project 创建（精确 `workspace_names` 匹配） |
| `test_workspace_api.py` | 2 | Workspace 文件 API 路径 |
| `test_sandbox_security.py` | 类形式 | 沙箱逃逸回归 |

### 2.4 CI

`.github/workflows/ci.yml`：
- **backend-test**：`pip install -e ".[dev]"` + `ruff check app/` + `PYTHONPATH=backend pytest tests/ -v`
- **frontend-build**：`npm ci` + `npx tsc --noEmit` + `npm run build`

### 2.5 数据持久化

- `data/provider_config.json`：用户 BYOK 配置（脱敏 API Key、采样参数、上下文窗口等）
- `data/projects.json`：项目列表（问题 / 维度 / 工作空间文件 / 指标摘要）
- 两份文件都走**原子写**（`tmp → bak → rename`）

---

## 3. 怎么实现的（关键技术决策）

### 3.1 控制变量法 — `PipelineConfig`

每个 Pipeline 是一个完整的 Pydantic 模型（`backend/app/models.py`）。`DimensionRouter.route(dimension, selections)` 生成 configs 列表，只有被对比的维度字段变化；其余字段使用 `DEFAULT_BASE`（框架=langgraph、推理=react、上下文=sliding、Harness=bare、Prompt=zero_shot、`prompt_version="v1.0.0"`）。

### 3.2 并行执行 — `RunnerPool.stream_parallel`

```python
queue: asyncio.Queue[ArenaEvent | None] = asyncio.Queue()
workers = [asyncio.create_task(worker(c)) for c in configs]
# 主循环 yield queue 中的事件，直到收到 len(configs) 个 None 哨兵
```

`CancelledError` 时：取消所有 worker → `asyncio.gather(*workers, return_exceptions=True)` 等待清理 → 重新 raise。

### 3.3 工作空间隔离 — `contextvars.ContextVar`

`_current_workspace: ContextVar[str | None] = ContextVar("current_workspace")`。每个 Adapter 在进入时 `set_current_workspace(ws_name)`，工具通过 `_get_ws()` 拿到当前 workspace。**为什么不是 `threading.local`**：asyncio 任务会在不同线程间调度，`threading.local` 会在 `await` 时丢失；`ContextVar` 是官方异步栈感知方案。

### 3.4 Tool 沙箱 — 独立进程 + AST 静态校验

- `_safe_run_code(code, timeout)`：用 `mp.get_context("spawn")` 启动子进程，AST 先做静态检查（阻断 `__class__` 等 dunder、常见反射名、import），再执行
- 超时 `proc.join(timeout)` → `proc.terminate()` → 等 1s → `proc.kill()`
- 并发上限 `_RUN_CODE_SEM = threading.Semaphore(4)`，避免资源耗尽

### 3.5 LLM 用量统计 — 多源回退

`extract_usage`：
1. `output.usage_metadata`（LangChain 标准）
2. `output.response_metadata.usage` / `token_usage`（OpenAI 风格）
3. 都没有 → 走 `estimate_tokens(text)//3` 估算路径

`TokenTracker._usage_from_api` 标记是否曾拿到真实用量，决定 `effective_input_tokens` 走哪条路径。

### 3.6 Harness 循环 — `astream_events` 拦截

`HarnessRunner.stream_events` 直接 yield LangGraph 的图事件，但额外注入 `_harness: True` 的控制事件（verify / reflect / harness_edit）。Adapter 在事件循环里识别这种事件，转成对应 `ArenaEvent` 推给前端。

`verify_result` 解析失败时**默认未通过**（不静默放行，避免削弱 Harness 对比意义）。

### 3.7 上下文策略 — `vector` 在 Prompt 层注入

`build_messages(..., context=...)`：当 `context == "vector"` 且工作空间有文件时，构建 `SimpleVectorStore` 检索 top-3 相关片段，附到 user prompt 后。`summary` / `hybrid` / `sliding` 走 `ContextManager`。

### 3.8 Trace 流式渲染 — 稳定 key

`TraceView.mergeEvents` 用 `Map<"type:step", index>` 维护同一段的索引，避免 O(n) 扫描；`thought / thought_delta / thought_end` 共用 `thought:N` key，thought 段边收 delta 边累积，`thought_end` 切到完整 Markdown 渲染。

---

## 4. 修改意见（已知遗留问题与改进点）

> 这些是**主动记录的待改进项**，不是缺陷清单；按优先级排序。

### 4.1 高优先级

1. **测试运行数与 README/PRD 不一致**
   - README 写「108 用例」，PRD 也写「108」；实际 146 个 `test_` 函数（`grep -rE "^\s*(def |async def )test_" tests/ | wc -l` = 146）
   - 建议：以 `pytest --collect-only -q` 输出为准，并加 `pytest --co` 到 CI

2. **`is_mvp_ready` 死代码**
   - `router.py:118` 定义 `is_mvp_ready()` 注释「兼容保留」，但已无调用方
   - 建议：删除或迁移到测试 fixture

3. **`SimpleVectorStore` 每次重建**
   - `prompts.py:78` 在 `build_messages` 调用时 `SimpleVectorStore()` 新建一次
   - 建议：cache per workspace 或由 Adapter 预处理

### 4.2 中优先级

4. **Workspace TTL=1h 对 Arena 长会话不够**
   - 用户多轮 Trace 对比需要历史 workspace，但 `DEFAULT_TTL_SECONDS=3600` 默认回收
   - 建议：ArenaClient 在「保存为项目」时同步备份到 `data/projects.json` 的 `workspace_files`，避免回收后丢文件

5. **`on_node_start` 黑名单耦合**
   - `langgraph_adapter.py:185` 写死 `node_name not in ("agent", "execute")` 才输出 thought 事件
   - 建议：在 `reasoning_graph.py` 暴露节点元数据（`get_node_metadata(node_name)`），由 Adapter 查询而非硬编码

6. **`_pipeline_overrides` 缺少自动重置保障**
   - Adapter 用 try/finally 调 `clear_pipeline_llm_overrides()`，但若 runner 在 await 中被 `CancelledError` 取消，finally 一定执行吗？
   - 建议：测试覆盖「CancelledError 路径下 ContextVar 是否清空」

7. **TraceDiff 文本截断到 300 字符**
   - `TraceDiff.tsx:205` `text.length > 300 ? text.slice(0, 300) + "…"`
   - 建议：暴露「展开」交互，避免长 thought 看不全

### 4.3 低优先级

8. **前端只有 AR 主题切换，无 i18n**
   - `ThemeToggle` 是亮 / 暗切换，没做多语言
   - 建议：暂缓，等 Phase 8 学习路径阶段再加

9. **`scratchpad` / 多轮任务模板尚未实现**
   - PRD §2.2「任务模板库」标注「尚未实现」，当前 `ArenaClient` 只有 3 个 in-page 示例
   - 建议：从「可自动判分」类型开始（JSON 解析 / 关键词命中）

10. **`openai_chat` Provider 测试能用但默认仍是 Anthropic**
    - `api/settings.py:76` 已实现 OpenAI 测试路径，但 `Settings.api_format` 默认 `anthropic_messages`
    - 建议：Settings UI 提示「OpenAI 兼容需自行确认 use_full_url / auth_field」

11. **CI 没跑 mypy**
    - `pyproject.toml` 配置了 `[tool.mypy]`，但 CI 只有 ruff + pytest
    - 建议：可选加 `mypy app/`，strict 模式可能太重，先用 `--ignore-missing-imports`

12. **pre-commit 与 ruff 行长 160**
    - `.pre-commit-config.yaml` ruff 行长可能与 pyproject 一致但建议确认

---

## 5. 路线图（基于现状的修订）

> 原 PRD 路线图已与实际进展错位；以下按当前代码反推未来工作。

| 阶段 | 目标 | 状态 |
|---|---|---|
| Phase 1-5 | 已在 `main` 分支落地（5 个维度 + 对比报告 + Trace + Workspace + 项目） | ✅ |
| Phase 6 | Adapter 接入 AutoGen / CrewAI（`FrameworkAdapter` Protocol 已就位） | ⏳ |
| Phase 7 | MCP 集成（PRD §4.3） | 📝 规划 |
| Phase 8 | 学习路径引导 UI | 📝 规划 |
| Phase 9 | 任务模板库（可自动判分） | 📝 规划 |
| Phase 10 | Harness Lab（独立 YAML 编辑器） | 📝 规划 |
| Phase 11 | CI 加 mypy / Node 版本矩阵 | ⏳ |

---

## 6. 重要事实速查

- **前端框架**：Next.js 16.2.10。⚠️ `frontend/AGENTS.md` 明确警告：**This is NOT the Next.js you know**，写代码前必须读 `node_modules/next/dist/docs/`，已弃用的 API 与训练数据可能不一致
- **默认 Provider**：StepFun（`anthropic_messages` 兼容），Base URL `https://api.stepfun.com/step_plan`
- **默认模型**：`step-3.7-flash`
- **Provider 测试命令**：`Settings → 管理与测试`
- **运行 Arena**：根目录 `cd backend && uvicorn app.main:app --reload --port 8000` + 另起终端 `cd frontend && npm run dev`
- **跑全部测试**：`PYTHONPATH=backend pytest tests/ -v`（根目录）
- **backend 测试数**：20 文件 / 146 函数（实测，`grep -E "^\s*(def\|async def) test_" tests/ -r`）
- **workspace 限制**：最多 32 个；空闲 > 1h 自动回收；LRU 淘汰
- **run_code 超时**：1~10s，超时强制 terminate + kill 子进程
- **请求体上限**：10MB，超出返回 413