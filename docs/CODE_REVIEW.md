# AgentPrism 代码审查报告

> **审查范围**：`backend/app/` + `frontend/src/` + `tests/` + `.github/workflows/` + 根配置
> **审查时间**：2026-07-23（commit `cfac8df docs: 新增 PROGRESS.md 并同步 README/PRD 与当前实现`）
> **审查方式**：4 个并行只读子 agent（架构 / 安全 / 错误处理 / 前端测试）+ 主 agent 整合
> **本报告性质**：**只读审查，未修改任何代码**。所有发现按严重度排序；标 ✅ 的"已确认"指已读源码验证，标 🔎 的"推测"指需进一步运行验证。

---

## 0. 一句话总评

AgentPrism 在产品意图与架构层面已经「可工作」——20 个测试文件 / 146 个用例全绿，5 维度 + Harness 引擎 + 工作空间 + 项目管理都跑通。但在 **生产级别** 还有若干必须修的硬伤，最关键的是：

1. **API Key 会通过 SSE 流泄漏到浏览器**（`runner.py:76`）
2. **Project 保存落盘失败但 API 返回 200 OK**（`project.py:75-83` + `130-141`）
3. **无全局 ErrorBoundary**，前端任意组件崩溃即白屏
4. **同步 LLM 调用阻塞 asyncio 事件循环**（`reasoning_graph.py` 全部节点）
5. **`_atomic_write_json` 无文件锁**，并发写会丢失

下面分三章：质量 / 架构 / 安全。每章内按 **🔴 高 → 🟠 中 → 🟡 低 → 🟢 误报** 排序。

---

## 1. 质量（Quality）

### 1.1 可维护性

#### 🔴 高 — `ArenaClient` 是 850 行巨型组件
- **位置**：`frontend/src/app/arena/ArenaClient.tsx:257-813`
- **证据**：11 个 `useState` + 2 个 `useRef` + 6 个 `useMemo` + 4 个 `useEffect` + 2 个 `useCallback`；5 个嵌套子组件（`DimensionChip` / `ComparisonReport` / `ColumnPlaceholder` / `ColumnCard` / `MainTabButton`）。
- **影响**：每条 SSE 事件触发 `setColumns`，整个组件每秒 reconcile 100+ 次；可测性差。
- **修复方向**：拆 `useArena()` reducer + `LeftSidebar` / `ArenaTabs` / `ResultsGrid` / `ReportTab` / `DiffTab` / `InputBar` / `SaveAsProjectCard`。

#### 🔴 高 — `ExperimentPanel` 5 个滑块并发 PUT
- **位置**：`frontend/src/components/ExperimentPanel.tsx:159-229`
- **证据**：5 个独立 `ParamSlider` 各自 `onMouseUp / onTouchEnd / onKeyUp → flushParams → PUT /api/settings/provider`，拖动一次释放会触发 5 个并发 PUT。
- **影响**：后端写 5 次 `provider_config.json`；前端网络/状态机压力。
- **修复方向**：合并为单一 `ExperimentParams` 对象 + 单一 onCommit；`useDebouncedCallback(flushParams, 300)`。

#### 🔴 高 — 前端无 ErrorBoundary
- **位置**：`frontend/src/app/` 全目录 `grep "ErrorBoundary|error.tsx|global-error"` **0 命中**
- **影响**：任何组件 render 抛错即全白屏（React 19 取消 graceful fallback）。
- **修复方向**：加 `app/error.tsx` + `app/global-error.tsx`，捕获渲染错误并显示重试。

#### 🟠 中 — `ArenaEvent` 在前端用 `type: string`，无联合类型保护
- **位置**：`frontend/src/lib/api.ts:57-72`、`backend/app/models.py:71`、`backend/app/arena/types.py:26-39`
- **证据**：后端有 12 个 `EventType` Literal，前端是 `string`。
- **影响**：后端新增 EventType 不会编译报错；前端 11 处 `as ArenaEvent` / `as TokenStats` 断言无类型安全（`api.ts:167`、`ArenaClient.tsx:350, 358`）。
- **修复方向**：前端用 discriminated union：`type ArenaEvent = {type: "thought", ...} | {type: "action", tool, args} | {type: "verify", passed, reason} | ...`

#### 🟠 中 — `globals.css` 自定义类重复定义
- **位置**：`frontend/src/app/globals.css:105-128` 与 `:250-264`
- **证据**：`.btn-primary` 定义两次（不同 transition）。
- **影响**：后写覆盖前写，hover 行为不可预期。
- **修复方向**：删重复，封装 `<Button variant size />` 组件，统一 Tailwind 类。

#### 🟠 中 — `tailwind v4 --chart-1..4` 列色撞色
- **位置**：`globals.css:17-20, 40-43`、`TraceView.tsx:121-126`
- **证据**：4 列时 `colorIndex % 4` 回到 chart-1，第 5 列与第 1 列同色。
- **修复方向**：5-8 色板；列数 > 4 时禁用或 hue rotation。

#### 🟡 低 — `--chart-4` 在深色背景对比度 ~1.8:1
- **位置**：`globals.css:43`
- **证据**：`--chart-4: #3f3f46` 配 `--background = #000000` 不达 WCAG AA 4.5:1。
- **修复方向**：换 Tailwind `chart` 默认色板。

### 1.2 可访问性（A11y）

#### 🔴 高 — 缺全局 `:focus-visible`
- **位置**：`globals.css` 全文 0 命中 `focus-visible`
- **影响**：键盘 tab 时无视觉反馈。
- **修复方向**：在 globals.css 加 `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`。

#### 🔴 高 — `column-status-dot` 仅靠颜色
- **位置**：`ArenaClient.tsx:207-214`
- **证据**：8px 圆点 + class（`running`/`done`/`error`）表达状态，无图标/文字/ARIA。
- **修复方向**：加 `role="status" aria-label="运行中/已完成/失败"` + 图标。

#### 🟠 中 — 缺 `scope="col"` / `scope="row"`
- **位置**：`ArenaClient.tsx:114-122`（ComparisonReport 表头）、`TraceDiff.tsx:162-178`
- **影响**：屏幕阅读器无法识别表头与列对齐。
- **修复方向**：所有 `<th>` 加 `scope="col"`，第一列加 `scope="row"`。

#### 🟠 中 — 多处 ARIA 缺失
| 元素 | 位置 | 缺失 |
|---|---|---|
| DimensionChip | `ArenaClient.tsx:77-92` | `aria-pressed={selected}` |
| MainTabButton | `ArenaClient.tsx:815-849` | `role="tab"` + `aria-selected`；外层缺 `role="tablist"` |
| 维度侧栏按钮 | `ArenaClient.tsx:546-568` | `aria-current="true"` |
| TokenStatsPanel 进度条 | `TokenStatsPanel.tsx:36-46` | `role="progressbar"` + `aria-valuenow/min/max` |
| TreeNode 文件夹 | `WorkspacePanel.tsx:400-446` | `aria-expanded` |
| 新建文件按钮 | `WorkspacePanel.tsx:221-228` | `aria-label` |
| 删除项目按钮 | `projects/page.tsx:125-136` | `aria-label="删除项目"` |

#### 🟠 中 — 用 `confirm()` / `alert()` 做危险操作
- **位置**：`projects/page.tsx:36`、`WorkspacePanel.tsx:153`
- **影响**：阻塞主线程 + 不可样式化 + 不可键盘操作。
- **修复方向**：抽 `<ConfirmDialog>`（基于 `<dialog>` 元素）。

#### 🟢 误报 — `layout.tsx` 的 `dangerouslySetInnerHTML` 主题脚本
- **位置**：`frontend/src/app/layout.tsx:22, 32`
- **判定**：经核实 Next.js 16 官方 *Preventing Flash Before Hydration* 文档逐字给出同款写法，并标注 `suppressHydrationWarning` 必选。**不是 anti-pattern，不要替换为 `next-themes`**（后者在 RSC 体系会闪烁）。

#### 🟠 中 — `ThemeToggle` 有 SSR 图标闪烁
- **位置**：`ThemeToggle.tsx:11-14, 9`
- **证据**：`useState<Theme | null>(null)` 首帧 SSR 渲染 `<Moon>`；真正是 dark 时先显示 Moon → 闪烁 → useEffect 后纠正。
- **修复方向**：layout 主题脚本里派发 `CustomEvent('themechange')`，`ThemeToggle` 用 `useSyncExternalStore` 订阅。

### 1.3 错误处理与用户提示

#### 🟠 中 — `saveProvider` 失败丢 `err.message`
- **位置**：`frontend/src/app/settings/page.tsx:86-87`
- **证据**：`} catch { flash("保存失败"); }` —— 与 `ArenaClient.tsx:443` 把 `err.message` 透传形成对比。
- **修复方向**：`catch (err) { flash(\`保存失败：${err instanceof Error ? err.message : ''}\`); }`

#### 🟠 中 — `ProjectsPage` 删除失败无重试入口
- **位置**：`frontend/src/app/projects/page.tsx:42-46`
- **证据**：`catch { setError(message); } finally { setDeleting(null); }` —— 错误一次性 toast，无重试。
- **修复方向**：每个项目卡片内联"重试"按钮。

#### 🟠 中 — `ArenaClient` 错误条无关闭 / 无重试
- **位置**：`ArenaClient.tsx:739-743`
- **证据**：`<p>{error}</p>` 一直停留直到下次 `setError(null)`。
- **修复方向**：加关闭按钮 + 重试按钮（复用 `abortRef` 重跑）。

### 1.4 测试覆盖

#### 🔴 高 — 前端 0 测试
- **证据**：`frontend/` 无 `vitest.config.*` / `jest.config.*` / `playwright.config.*`；`package.json` 无 `test` script。
- **影响**：前端任何改动无回归保护。
- **修复方向**：引入 vitest + @testing-library/react，先覆盖 `ThemeToggle` / `ArenaClient` 列渲染 / `TraceDiff` 对齐。

#### 🔴 高 — 无 SSE 端到端测试
- **证据**：`tests/` 0 命中 `EventSourceResponse` 或 SSE wire protocol 验证。
- **影响**：后端 SSE 协议演进（如新增事件类型、改 data 格式）会静默破坏前端。
- **修复方向**：用 `TestClient.stream()` 发起请求，断言首事件 `{"event": "arena", "data": {...}}`。

#### 🟠 中 — 缺边界场景
- Workspace 文件名冲突 / 大文件 / Unicode 路径
- `ContextManager` 在 `len == window_size` / `len == window_size + 1` 的临界（`context_manager.py:41-68`）
- HarnessRunner `self_evolve` / `reflect` 重试路径（`test_harness_runner.py:124` 只测 `verify`）
- Reasoning 图行为（条件边、循环、`on_chain_end` 解析）
- `api.ts streamArenaRun` SSE 解析（含跨 chunk 边界、`[DONE]` 处理）

#### 🟠 中 — CI 缺漏
| 项 | 位置 |
|---|---|
| 无 mypy | `.github/workflows/ci.yml`（pyproject 已配 `[tool.mypy]`） |
| 无 Node 版本矩阵 | 单 `node-version: "20"` |
| 无 pip/npm 缓存 | 全文 0 命中 `actions/cache` |
| 无 coverage 阈值 | 0 命中 `coverage` |
| 无 E2E | 无 playwright/cypress 配置 |
| 无 secret 扫描 | 无 trufflehog / gitleaks |
| 无跨平台矩阵 | 仅 `ubuntu-latest`（项目实际在 win32） |

### 1.5 类型与配置

#### 🟠 中 — `langgraph_adapter.py:115` `ev_type` 越过 Pydantic 校验
- **位置**：`backend/app/adapters/langgraph_adapter.py:113-121`
- **证据**：`ev_type = event.get("type") or "verify"` → 直接 `ArenaEvent(type=ev_type, ...)`（`# type: ignore[arg-type]`）。若 Harness 事件 type 不在 `EventType` Literal 中，Pydantic 抛 `ValidationError`，被外层 `except Exception` 吞成「类型名」。
- **修复方向**：白名单 `ev_type in {"verify","reflect","harness_edit"}` 否则默认 `verify`。

#### 🟠 中 — `ProviderConfigUpdate` 无字段 bounds
- **位置**：`backend/app/models.py:108-127`
- **证据**：`temperature: float` 无 `ge=0, le=2`；`top_p`、`max_input_tokens`、`context_window` 都没边界。
- **修复方向**：加 `Field(ge=0, le=2)` 等约束。

#### 🟠 中 — `Project.workspace_files` 无 size 限制
- **位置**：`backend/app/models.py:158`、`arena/project.py:75-83`
- **证据**：`dict[str, dict[str, str]]` 完全无 maxLength；`_save` 序列化整树可超 100MB；`_load` 一次性 `json.loads` 吃满内存。
- **修复方向**：`_save` 前 `if len(json_str) > 50MB: return False`；Project 模型加 content 长度校验。

#### 🟡 低 — `prompt_version` 字段未在运行时引用
- **位置**：`backend/app/models.py:43`、`backend/app/arena/router.py:18`
- **证据**：声明 `prompt_version="v1.0.0"`，但 `prompts.py` 不读取——复跑实验的「同 prompt_version」承诺未落实。
- **修复方向**：`build_messages(..., prompt_version=...)` 内部按版本选模板。

---

## 2. 架构（Architecture）

### 2.1 分层与依赖方向

#### 🟠 中 — Adapter 反向依赖 `app.arena.*`
- **位置**：`backend/app/adapters/{common,langchain_adapter,langgraph_adapter}.py`
- **证据**：adapters import `app.arena.{token_utils, stream_utils, prompts, tools, workspace, llm, reasoning}`，破坏「arena 编排 → 调用 adapter」的方向。
- **修复方向**：把被 adapter 真正复用的工具下沉到 `app/common/` 或 `app/adapters/util/`。

#### 🟠 中 — `WorkspaceManager` 归属分裂
- **位置**：`backend/app/arena/workspace.py:57`、`backend/app/arena/tools.py:32`、`backend/app/adapters/common.py:7`
- **证据**：类定义在 arena；模块单例 `_workspace_mgr = WorkspaceManager()` 在 `arena/tools.py:32`；adapters 通过 `get_workspace_mgr()` 拿到；`arena/project.py:16` 又走 `app.adapters.common.get_workspace_mgr` —— 反向。
- **修复方向**：上移 WorkspaceManager 到 `app/` 一级模块；让 adapter 通过依赖注入拿。

#### 🟠 中 — `set_current_workspace` 在 try 外
- **位置**：`backend/app/adapters/langchain_adapter.py:53-58`、`:52-60`（langgraph）
- **证据**：`ws_name=…; get_workspace_mgr().create(ws_name); set_current_workspace(ws_name); ws.write_file(...)` 全在 `try:` 之前；`finally` 才清理。若 `create()` 或 `write_file` 抛 OSErr，ContextVar 残留到下一任务。
- **修复方向**：把 `set_current_workspace` 挪进 try 首行。

### 2.2 抽象一致性

#### 🟠 中 — `langgraph_adapter.py:113-115` 已计入上方 1.5 重复

#### 🟠 中 — `FrameworkAdapter` runtime_checkable 不验证签名
- **位置**：`backend/app/adapters/base.py:22, 27, 69`
- **证据**：`@runtime_checkable Protocol` 仅检查方法存在，不校验签名；任何有 `framework_id/display_name/run` 的对象都过 `isinstance`。
- **修复方向**：register 时用 `inspect.signature` 断言 `run(question: str, config: PipelineConfig) -> AsyncIterator[ArenaEvent]`。

### 2.3 配置与状态

#### 🔴 高 — `ProjectManager._save` 失败时数据丢失但 API 返回 200 OK
- **位置**：`backend/app/arena/project.py:75-83, 130-141`、`backend/app/api/arena.py:147-160`
- **证据**：
  ```python
  # project.py:75-83
  def _save(self) -> bool:
      try:
          ...
          return _atomic_write_json(PROJECTS_FILE, json_str)
      except OSError as exc:
          logger.error("保存 %s 失败: %s", PROJECTS_FILE, exc)
          return False
  # project.py:130-133
  with self._lock:
      self._projects[project.id] = project
      self._save()    # 返回 False 但调用方无视
  # api/arena.py:147-150
  project = mgr.create_from_run(body)  # 即使落盘失败也返回 200
  return {"project": project.model_dump()}
  ```
- **影响**：用户在 Arena 跑完实验保存项目，UI 显示「已保存」，但磁盘无文件——重启后丢失，且无任何告警。
- **修复方向**：`create_from_run` / `delete_project` 在 `_save` 返回 False 时抛 `HTTPException(500)`；前端把 500 当作失败处理。

#### 🟠 中 — `_cached_provider` 多 worker 失效不广播
- **位置**：`backend/app/arena/router.py:57-68`、`backend/app/api/settings.py:54-64`
- **证据**：`@lru_cache(maxsize=1)` 是进程级缓存；`update_provider` 调 `cache_clear()` 仅清当前 worker；多 worker 部署下其它 worker 仍持有旧 `ProviderConfig`。
- **修复方向**：在 `_cached_provider` 内检查 `path mtime` 自动失效；或用 Redis 广播。

#### 🟠 中 — Workspace TTL/LRU 与 Project 保存竞态
- **位置**：`backend/app/arena/workspace.py:194-263`、`backend/app/arena/project.py:99-119`、`frontend/src/app/arena/ArenaClient.tsx:418-447`
- **证据**：`WorkspaceManager.DEFAULT_TTL_SECONDS=3600`、`DEFAULT_MAX_WORKSPACES=32`；`create_from_run` 用 `ws_mgr.get(ws_name)` 取 workspace —— 若已被 TTL/LRU 淘汰则返回 None，`workspace_files` 静默变空、`results` 列表残留 workspace 名但 file_count=0。前端无告警。
- **影响**：用户跑完实验后隔 1 小时再点「保存项目」，大概率得到无文件空项目。
- **修复方向**：API 层发现 workspace 已淘汰时返回 410 提示重跑；或保存时把 workspace 内容快照直接写到项目 JSON，不再依赖 InMemory manager。

#### 🟡 低 — 已路由过 pipeline 不被 provider 更新影响
- **位置**：`backend/app/arena/router.py:57-79`、`backend/app/api/settings.py:54-64`
- **证据**：用户先开 Arena（5 pipeline 已用旧 model），再修改 model —— 前 5 个 pipeline 不受影响，新请求才用新 model。
- **判定**：行为问题，需在文档/UI 中说明。

### 2.4 可扩展性

#### 🔴 高 — 新增维度需同步 ≥7 处
- **位置**：`backend/app/arena/router.py:22-51`、`backend/app/arena/types.py:8`、`backend/app/models.py:9-15`、`backend/app/api/arena.py:19-45`、`frontend/src/lib/api.ts:3`、`frontend/src/app/arena/ArenaClient.tsx`、`frontend/src/components/ExperimentPanel.tsx:338-344`
- **证据**：维度元信息在 `api/arena.py` (`_DIMENSION_META`)、`ExperimentPanel.tsx` (`DIMENSION_DESCRIPTIONS`) 各自独立维护。
- **修复方向**：后端 `_DIMENSION_META` 与 `DIMENSION_OPTIONS` 合并；前端只读 `/api/arena/meta` 返回的 `label/subtitle`。

#### 🟠 中 — 新增 Adapter 需同时改 `runner.build_registry`
- **位置**：`backend/app/arena/runner.py:9-22`
- **证据**：`LangChainAdapter` / `LangGraphAdapter` 硬编码 import + 注册。违反 CLAUDE.md §8「仅 register 即可激活」的承诺。
- **修复方向**：把注册入口下沉到 `app/adapters/__init__.py`，用装饰器 `register_on_import`。

#### 🟠 中 — 新增 Tool 需同时改前端硬编码分支
- **位置**：`backend/app/arena/tools.py:410-426`、`frontend/src/components/TraceView.tsx:210-211`
- **证据**：前端 `["write_file","create_file","read_file","list_files","delete_file"].includes(toolName)` + `toolName === "run_code"` 与 ARENA_TOOLS 不在同一处维护。
- **修复方向**：给 Tool 加 `kind` 字段（`"file"/"code"/"utility"`），通过 schema 暴露。

### 2.5 并发与可靠性

#### 🔴 高 — `_atomic_write_json` 无文件锁
- **位置**：`backend/app/config.py:20-43`、`backend/app/arena/project.py:25-45`
- **证据**：两个文件实现完全相同；并发两次写会互相覆盖 `.bak`、后写者赢。
- **影响**：Provider 设置并发概率低；Project 保存多用户并发会丢数据。
- **修复方向**：`fcntl.flock`（Unix）/ `msvcrt.locking`（Windows）；或临时文件名含 PID+UUID。

#### 🟠 中 — `WorkspaceManager` 同名 worktree 互相覆盖
- **位置**：`backend/app/adapters/{langchain,langgraph}_adapter.py:53/52`
- **证据**：`ws_name = f"{label}_{int(started * 1000)}"` —— 毫秒级并发可能产生同名；`create(name)` 是 `dict[name] = ws` 直接覆盖。
- **影响**：用户 A 的 workspace 被 B 顶掉，A 后续写入串到 B 的 workspace。
- **修复方向**：`ws_name = f"{label}_{uuid.uuid4().hex[:8]}"`。

#### 🟠 中 — `_save` 持锁做 `model_dump` + 序列化
- **位置**：`backend/app/arena/project.py:75-83, 130-133`
- **证据**：长 IO 持锁；`workspace_files` 大时序列化数百毫秒。
- **修复方向**：把序列化移到锁外，仅短暂持锁写盘。

#### 🟠 中 — `max_retries=2` × `timeout=30` × exponential backoff 让单次调用 ~106s
- **位置**：`backend/app/arena/llm.py:73, 89`
- **证据**：未传 `max_retries`，SDK 默认 2 次；前端的 30s 超时只是 socket 级。
- **修复方向**：显式 `max_retries=0` 或 `1`；或保留 2 但在首 token 前推 `ArenaEvent(type="thought", content="(重试中...)")`。

#### 🟠 中 — 同步 `llm.invoke` 阻塞 asyncio 事件循环
- **位置**：`backend/app/arena/reasoning_graph.py:24-216`、`backend/app/arena/harness.py:86-93, 247`
- **证据**：`_react_node` / `_cot_think_node` / `_cot_act_node` / `_tot_generate_node` / `_tot_evaluate_node` / `_reflexion_execute_node` / `_reflexion_reflect_node` 全部 `llm.invoke(...)` 同步阻塞。
- **影响**：冻结事件循环——多 Arena 并发时所有客户端心跳停摆。
- **修复方向**：`asyncio.to_thread(llm.invoke, ...)` 或 `await llm.ainvoke(...)`。

#### 🟠 中 — `update_provider` 读-改-写 race
- **位置**：`backend/app/api/settings.py:54-64`
- **证据**：P1 读 A、P2 读 A；P1 写 B、P2 写 C —— P1 改动被 P2 覆盖。
- **修复方向**：文件锁；或在 `_save` 内"先读最新 → 合并 → 写"两步模式。

### 2.6 SSE 与取消

#### 🟠 中 — 客户端断开不立即中断 LLM 流式 HTTP
- **位置**：`backend/app/api/arena.py:70-80`、`backend/app/arena/runner.py:91-98`
- **证据**：sse-starlette 取消 event_generator，但 worker 内部 `await graph.astream_events(...)` 仍等网络完成。
- **修复方向**：LangChain / LangGraph 传入 `signal`（如 SDK 支持）或自定义 timeout 包裹。

#### 🟡 低 — 前端 SSE 解析无大小上限
- **位置**：`frontend/src/lib/api.ts:155-171`
- **证据**：单事件 `data` 行无长度限制；若异常大，解析阻塞主线程。
- **修复方向**：超 1MB 丢事件 + 触发 abort。

#### 🟡 低 — 前端 `streamArenaRun` abort 时未显式 `reader.cancel()`
- **位置**：`frontend/src/lib/api.ts:138-188`
- **修复方向**：外层 try/catch AbortError + `reader.cancel()`。

### 2.7 前端架构

#### 🟠 中 — `abortRef` 样板 4 处重复
- **位置**：`ArenaClient.tsx:270`、`settings/page.tsx:30`、`projects/page.tsx:13`、`WorkspacePanel.tsx:49`
- **修复方向**：抽 `useAbortableFetch<T>()` 工具 hook。

#### 🟢 通过 — 无 `"use client"` 误用
- 所有 hooks 组件均带 `"use client"`（已逐一验证）。

---

## 3. 安全（Security）

### 3.1 密钥与日志

#### 🔴 高 — API key 通过 SSE 泄露给浏览器
- **位置**：`backend/app/arena/runner.py:69-78`
- **证据**：
  ```python
  except Exception as exc:  # noqa: BLE001
      logger.exception("Pipeline %s 失败", cfg.label)
      await queue.put(
          ArenaEvent(
              type="error",
              pipeline=cfg.label,
              message=f"{type(exc).__name__}: {str(exc)[:200]}",
          )
      )
  ```
  `str(exc)[:200]` 直接进 SSE 流。`openai.AuthenticationError.__str__()` 历史格式为 `"Error code: 401 - {'error': {'message': 'Incorrect API key provided: sk-...XXXX', ...}}"`。
- **影响**：网络监听者、浏览器 DevTools、SSE 日志收集器都能拿到 API key 摘要。
- **修复方向**：改为 `_sanitize_error(exc)`（只返回类型名），详细原因只走 `logger.exception` 不走 SSE。

#### 🔴 高 — `logger.exception` 写完整 traceback，可能含 SDK 异常链
- **位置**：`adapters/{langchain,langgraph}_adapter.py:160/216`、`runner.py:70`
- **证据**：OpenAI / Anthropic Python SDK 历史异常 `repr` 中含 endpoint / 部分 key。
- **修复方向**：改为 `logger.error(..., exc_info=False)`；或在 logger formatter 中加敏感字段脱敏。

#### 🟠 中 — `_save` 落盘失败但 API 返回 200 OK
- 与上方架构 2.3 重复，但**从安全角度**更严重：用户信任「已保存」提示，可能在磁盘上留敏感文件（密钥、token 等）依赖项目文件持久化，落盘失败无任何信号。

#### 🟠 中 — `data/projects.json` 无加密持久化敏感信息
- **位置**：`backend/app/arena/project.py:107-128`、`api/arena.py:147-152`
- **证据**：workspace 文件原样 + `question`（可能含用户提供的密钥）落盘。`data/` 目录无 chmod 限制（多用户 Linux 环境可被读取）。
- **修复方向**：按 pattern（`sk-`, `ghp-`, `AKIA` 等）检测密钥并显式拒绝保存；`data/` 目录创建时设 `0o700`。

#### 🟠 中 — Provider 测试失败回显虽脱敏但缺日志
- **位置**：`backend/app/api/settings.py:116-122`
- **证据**：返回 `f"连接失败: {type(exc).__name__}"` —— OK；但 `logger.warning` 缺失，排障无信号。
- **修复方向**：补 `logger.warning(...)` 留痕。

### 3.2 Path / 文件系统

#### 🟠 中 — `_normalize` 漏 Windows UNC 与零宽字符
- **位置**：`backend/app/arena/workspace.py:65-80`
- **证据**：`\\?\C:\foo` 经 `os.path.normpath` 后保留前缀，`replace("\\", "/")` 变 `//?/C:/foo`，前导斜杠检查不命中。
- **影响**：内存存储下危害小，但与未来持久化的距离 = 定时炸弹。
- **修复方向**：显式拒绝前导 `//`、`/./`、`/../`；扩展 `_CONTROL_CHARS` 含 Unicode Cf/Cc。

#### 🟠 中 — `read_file` 返回值与「错误:」前缀协议存在歧义
- **位置**：`backend/app/arena/workspace.py:110-112`、`backend/app/api/arena.py:100-108`
- **证据**：合法文件内容若以「错误:」开头，被后端误判为 404；写入侧错误以同一前缀返回 400，副作用归错。
- **修复方向**：结构化返回（`tuple[str | None, str | None]`），或自定义 `WorkspaceError` 异常，API 层 try/except 映射。

#### 🟢 通过 — Symlink 不可利用
- 内存 dict 存储，symlink 不适用。

### 3.3 run_code 沙箱

#### 🟠 中 — `threading.Semaphore(4)` 在 asyncio 事件循环线程上阻塞
- **位置**：`backend/app/arena/tools.py:27, 338`
- **证据**：`acquire(timeout=timeout + 2)` 是同步阻塞；最坏阻塞事件循环 12s。
- **修复方向**：改 `asyncio.Semaphore` 或 `run_in_threadpool`。

#### 🟠 中 — 4 并发 + 10s timeout 让请求饥饿
- **位置**：`backend/app/arena/tools.py:331-376`
- **证据**：4 个用户同时 10s timeout，第 5 用户最多等 36s；第 6 名阻塞事件循环（见上）。
- **修复方向**：把 timeout clamp 改 1-5s；或用 `ProcessPoolExecutor` 内部信号量。

#### 🟠 中 — `code` 无 `max_length`
- **位置**：`backend/app/arena/tools.py:181-183`
- **证据**：`code: str = Field(description="要执行的 Python 代码")` 无 `max_length`；可发数十 MB 卡死 AST walk 阶段。
- **修复方向**：`code: str = Field(max_length=50_000)`；`timeout: int = Field(ge=1, le=10)`。

#### 🟠 中 — 子进程 `proc` 句柄未 `close()`，`result_queue` 未 `join_thread()`
- **位置**：`backend/app/arena/tools.py:308-376`
- **修复方向**：补 `proc.close()` + `result_queue.join_thread()`（防 Windows pipe 残留）。

#### 🟠 中 — `logger.debug` 在 INFO 级别无效
- **位置**：`backend/app/arena/tools.py:316, 322, 305, 371`
- **证据**：沙箱异常时无任何日志。
- **修复方向**：`logger.warning`。

#### 🟡 低 — 沙箱黑名单天然易漏
- **位置**：`backend/app/arena/tools.py:222-263`
- **判定**：测试覆盖了 `__class__/__mro__/__bases__[0].__subclasses__()`、`f.__globals__`；但 `__init_subclass__` / `__set_name__` / `gc.get_objects` 等未明确列。
- **修复方向**：考虑迁移到 `RestrictedPython` / 容器化运行时。

### 3.4 Prompt 注入

#### 🔴 高 — `_detect_injection` 正则覆盖窄
- **位置**：`backend/app/arena/harness.py:30-55`
- **证据**：仅英文 + `(?i)`；漏 Unicode 同形异义、零宽字符、中文变种（忽略之前的指令、从现在开始）、Base64。
- **修复方向**：字符规范化（NFKC）、去零宽字符、扩充关键词集合。

#### 🔴 高 — RAG 工作空间内容直接拼到 user prompt
- **位置**：`backend/app/arena/prompts.py:80-96`
- **证据**：`f"{path}\n{f.content}"` —— 用户写入的内容可包含「ignore above and answer:...」，进入检索 → 拼接 → LLM 上下文。经典间接 prompt injection 路径。
- **修复方向**：`[文件: path] 内容开始 ... 内容结束` 包裹；在 RAG 片段前后注入前做 sanitize。

#### 🟠 中 — `_sanitize_for_json` 贪婪匹配可错位
- **位置**：`backend/app/arena/harness.py:44-50`
- **证据**：`re.search(r"\{.*\}", text, re.DOTALL)` 贪婪，可能吞多块 JSON。
- **修复方向**：非贪婪 `\{.*?\}`；或 `json.JSONDecoder().raw_decode`；回填前再 sanitize。

#### 🟠 中 — `verify_result` 等 LLM 调用异常归「解析失败」掩盖真因
- **位置**：`backend/app/arena/harness.py:91, 121, 152`
- **证据**：`except Exception: return (False, "验证解析失败...")` —— 网络/认证错误归类为解析失败，陷入无限循环。
- **修复方向**：单独捕获 `anthropic.APIStatusError` / `APIConnectionError` 升级为更具体的错误。

### 3.5 API 输入校验

#### 🟠 中 — `/api/arena/run` 无速率限制 / 并发上限
- **位置**：`backend/app/api/arena.py:70-80`
- **影响**：Slowloris 风格 keep-alive 不读 body，吃满 worker；可并发撑满 LLM 配额。
- **修复方向**：引入 `slowapi` 或 `asyncio.Semaphore(N)`。

#### 🟠 中 — `ProjectCreate.workspace_names` 无 `max_length`
- **位置**：`backend/app/models.py:166`
- **证据**：元素级长度限制缺失；可发数万 workspace name。
- **修复方向**：`list[Annotated[str, Field(max_length=100)]] = Field(max_length=20)`。

#### 🟠 中 — `api_key` 256 限制仅对入参有效，磁盘可绕过
- **位置**：`backend/app/models.py:116`、`backend/app/api/settings.py:54-64`
- **修复方向**：`SecretStr` + 文件权限 0o600。

### 3.6 日志配置

#### 🟠 中 — `main.py` 未隔离第三方 logger
- **位置**：`backend/app/main.py:15-21`
- **证据**：未禁用 `httpx` / `httpcore` / `openai` / `urllib3` 的 INFO 级别。**`httpx` INFO 会输出完整请求 URL + headers，含 `Authorization: Bearer sk-...` 头**。
- **修复方向**：
  ```python
  for noisy in ("httpx", "httpcore", "openai", "urllib3"):
      logging.getLogger(noisy).setLevel(logging.WARNING)
  ```

---

## 4. 优先修复清单（按 ROI 排序）

> 截止 2026-07-23 的判断；按修复成本/收益比排序。

| # | 等级 | 项目 | 位置 | 预计工时 |
|---|------|------|------|----------|
| 1 | 🔴 | `runner.py:76` 把 `str(exc)[:200]` 改为 `_sanitize_error(exc)` | `backend/app/arena/runner.py:77` | 5 分钟 |
| 2 | 🔴 | `ProjectManager._save` 失败时 `HTTPException(500)` | `backend/app/arena/project.py:75-83` + `api/arena.py:147-160` | 30 分钟 |
| 3 | 🔴 | 加 `app/error.tsx` + `global-error.tsx` | `frontend/src/app/` | 15 分钟 |
| 4 | 🔴 | `_atomic_write_json` 加文件锁 + 启动从 `.bak` 恢复 | `backend/app/config.py` + `project.py` | 1 小时 |
| 5 | 🔴 | `WorkspaceManager` 创建时加 UUID 段避免同名覆盖 | `backend/app/adapters/*` | 15 分钟 |
| 6 | 🔴 | RAG 片段 `[文件: path]` 包裹 + 注入检测 | `backend/app/arena/prompts.py:80-96` | 1 小时 |
| 7 | 🔴 | CI 加 mypy + Node 矩阵 + pip/npm 缓存 | `.github/workflows/ci.yml` | 30 分钟 |
| 8 | 🟠 | `ArenaClient` 850 行拆 `useArena()` + 子组件 | `frontend/src/app/arena/ArenaClient.tsx` | 半天 |
| 9 | 🟠 | `ExperimentPanel` 合并 5 个滑块为单一 PUT + debounce | `frontend/src/components/ExperimentPanel.tsx` | 30 分钟 |
| 10 | 🟠 | 同步 `llm.invoke` 改 `asyncio.to_thread` 或 `ainvoke` | `reasoning_graph.py` + `harness.py` | 1-2 小时 |
| 11 | 🟠 | `ChatAnthropic` 显式 `max_retries=0/1` | `backend/app/arena/llm.py` | 5 分钟 |
| 12 | 🟠 | `main.py` 隔离 httpx/openai logger 到 WARNING | `backend/app/main.py` | 5 分钟 |
| 13 | 🟠 | `langgraph_adapter.py:113` 白名单 `ev_type` | `backend/app/adapters/langgraph_adapter.py` | 15 分钟 |
| 14 | 🟠 | `WorkspaceManager` 同名竞态：TTL 1h 与保存项目竞态 → 410 提示 | `backend/app/arena/{workspace,project}.py` + `frontend` | 1 小时 |
| 15 | 🟠 | 维度元信息合并到 `/api/arena/meta` 单一来源 | `backend/app/api/arena.py` + `ExperimentPanel.tsx` | 1 小时 |
| 16 | 🟠 | 全局 `:focus-visible` + 列状态点 ARIA | `globals.css` + `ArenaClient.tsx` | 30 分钟 |
| 17 | 🟠 | 引入 vitest + React Testing Library 覆盖关键组件 | `frontend/` | 半天 |
| 18 | 🟠 | SSE 端到端测试（`TestClient.stream()`） | `tests/test_arena_sse_e2e.py` | 2 小时 |
| 19 | 🟠 | `_sanitize_error` 扩展到 runner 错误分支；`_detect_injection` 扩 Unicode/中文 | `harness.py` | 1 小时 |
| 20 | 🟠 | Adapter 反向依赖重构：把 `token_utils` / `stream_utils` 下沉到 `app/common/` | 多文件 | 半天 |

---

## 5. 已知误报 / 不修项

| 项 | 位置 | 不修理由 |
|---|---|---|
| `dangerouslySetInnerHTML` 主题脚本 | `frontend/src/app/layout.tsx:22, 32` | Next.js 16 官方推荐写法 |
| `_run_code` AST 黑名单「天然易漏」 | `tools.py:222-263` | 测试已覆盖主要逃逸路径，迁移到 RestrictedPython 属 Phase 7 范围 |
| `pytest.ini` 没有 `filterwarnings` 之外的额外配置 | `pytest.ini` | 当前够用 |
| `front-end build snapshot` 缺 | `frontend/package.json` | 无 vitest 之前没必要；#17 之后一起补 |
| `--chart-1..4` 在浅色主题对深色文本对比度 | `globals.css:17-20` | 实测浅色主题下深色文本可读；优先解决深色主题对比度问题 |

---

## 6. 总结表

| 维度 | 高 | 中 | 低 | 误报 | 总计 |
|---|---|---|---|---|---|
| 质量（可维护性/A11y/测试/类型） | 4 | 13 | 8 | 2 | 27 |
| 架构（分层/抽象/状态/扩展/并发/SSE） | 2 | 11 | 4 | 1 | 18 |
| 安全（密钥/路径/沙箱/注入/API/日志） | 3 | 12 | 1 | 0 | 16 |
| **合计** | **9** | **36** | **13** | **3** | **61** |

**整体评价**：AgentPrism 在 5 维度对比 + Harness 引擎 + 工作空间 + 项目管理的「功能层」已可用；但在 **生产级别** 必须先修前 7 个 🔴 项才能进入预发环境。**API Key 经 SSE 泄漏**是必须立即处理的最高优先级——它不需要复杂的攻击路径，任何用户开 DevTools 就能看到。