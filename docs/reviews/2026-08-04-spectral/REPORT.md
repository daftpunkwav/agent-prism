# AgentPrism 光谱审查 · 2026-08-04

> **审查范围**：`backend/app/`（35 个模块，6679 行）+ `frontend/src/`（约 7800 行）+ `tests/`（38 文件 / 344 用例）+ CI / 文档
> **审查基线**：`main` 分支 commit `d04b431`
> **审查者**：独立第三方（区别于 `docs/CODE_REVIEW.md` 与 `docs/AGENT_CODE_REVIEW.md`）
> **方法论**：直接阅读每一文件 + 既有审查复核 + 现场验证修复状态
> **不修改任何已有内容**

---

## 0. 总体评价

AgentPrism 是一个**工程质量明显高于同体量 Side-Project** 的项目：模块边界清晰、单一来源的 Literal 类型、可控变量法的对比维度设计、上下文策略与 Harness 引擎实现了真正差异化的可观测效果、测试覆盖面 38 文件 / 344 用例。视觉系统完整（Vercel 调性 + 光谱 lane 色板 + 4000 行 globals.css 体系）。

上轮 `AGENT_CODE_REVIEW.md` 中标记的 **HIGH 严重项几乎全部已在 main 分支修复**：

- ✅ `S1` `test_provider` 同步 SDK 已包 `asyncio.to_thread`（`api/settings.py:251,289`）
- ✅ `C1` 推理图节点 + harness 三函数全面改 async（`harness.py:117,155,184`；`reasoning_graph.py:45,53,149,164,...`）
- ✅ `S2` `_normalize` 已拦截 Windows 保留名与多点（`workspace.py:52,121`）
- ✅ `Q1` `EventType` 含 `verify/reflect/harness_edit` 是**设计意图**（供前端徽章细分），非缺陷
- ✅ `Q3` 两个 adapter 已抽出 `_common_run` 公共层

**本轮仍存在**的若干**新问题**集中在：**密钥明文残留**、**模块级可变全局状态**、**依赖文件重复**、**前端 `ArenaClient.tsx` 巨型组件**、**`.env` 入库风险**。下表按严重度分级，全部带文件:行号与可执行修复建议。

### 评级图例

| 标识 | 等级 | 含义 |
|---|---|---|
| 🔴 | **HIGH** | 影响安全/正确性/稳定性，必须修 |
| 🟠 | **MEDIUM** | 影响可维护性/健壮性/可读性，建议修 |
| 🟡 | **LOW** | 一致性/样式/小重构，可选修 |
| 🟢 | **POSITIVE** | 已被落实或设计良好的部分 |
| 🟣 | **DESIGN** | 架构层观察，不一定修，但应知晓 |

---

## 1. 安全性（Security）

### 🔴 H1. `.env` 文件包含真实 API Key 并存在于工作区

**位置**：仓库根 `.env:1-13`（`LLM_API_KEY=7kaS8nK...PZx7I`，完整 64 字符明文）

**事实**：
- `.gitignore:10` 正确忽略 `.env`（含 `!.env.example` 豁免）—— **未提交到 git**
- 但工作区**当前存在**该文件，未跟踪
- 若用户在编辑器、终端命令误用（如 `cat .env` 截图、`code .env` 同步设置），或 IDE 的某些插件默认同步到云端，会泄露

**风险**：密钥明文落地是**安全事件**的常见入口。"Key doesn't leave the disk unless the user explicitly moves it"在这里**已经被违反了一次**（因为该 Key 现在在你的工作区目录里）。

**修复建议**（按顺序执行）：

1. **立即撤销该 Key**：登录 StepFun 控制台，撤销/轮换 `LLM_API_KEY`（假设真有效）
2. **从工作区物理删除**：`rm .env`（不需保留，因为有 `.env.example` 模板）
3. **未来从 Settings 页面填写**（应用本身已支持「本地保存到 `data/provider_config.json`，UI 也可配」—— README §"配置 Provider"）
4. **若必须保留**本地 Key 文件，强制 `chmod 600`（在 Linux/macOS）并在 `.gitignore` 增 `data/provider_config.json` 检查（**已正确忽略**，见 `.gitignore:43`）
5. 文档 `CLAUDE.md` 加一条「严禁将真实 API Key 写入 `.env`；用 `.env.example` 模板或 Settings 页面」

**与既有审查的差异**：既有审查**未涉及**工作区文件检查，仅关注代码层。密钥管理是**流程 + 代码**双层问题。

---

### 🟠 M1. 跨用户/多租户部署模型缺失，workspace API 完全开放

**位置**：`backend/app/api/arena.py:122-171`（workspace 端点）

**事实**：
- 所有 workspace 端点直接接受 URL 路径参数 `workspace_name` 调 `_ws_mgr.get(workspace_name)`
- 无任何会话/所有权/token 校验
- 注释 `arena.py:115-117` 已明确「当前为单用户本地部署模型」

**风险**：
- 工作空间名后缀是 `uuid.uuid4().hex[:6]`（6 字节），**理论可枚举**（1677 万空间）
- 若用户将项目部署到 LAN / VPS（如端口 8000 直接暴露），任意客户端可构造请求读取/修改/删除他人工作空间

**修复建议**（**最低限度**）：
- 在 `arena.py:117` 注释后**追加**"**禁止部署到公网；若需部署，必须先实现 `AGENTPRISM_API_TOKEN` + workspace 所有权绑定**"红字
- `api_token` 机制已存在（`main.py:135-160`），已可单点开启
- workspace 名空间拼接可改为「随机 12 字节 + 时间戳」增加枚举难度（成本极低）
- 长期方案：每个 `Workspace` 关联创建时生成的 **opaque owner_token**（HttpOnly cookie 或 Authorization 头），所有 workspace 端点要求携带

---

### 🟢 已落实的安全加固（POSITIVE）

| 模块 | 措施 | 位置 |
|---|---|---|
| 请求体大小 | ASGI middleware 同时校验 Content-Length + 实际流字节 | `main.py:36-125` |
| 共享密钥认证 | `ApiTokenMiddleware`（可选，缺省零摩擦） | `main.py:127-160` |
| 并发限流 | `asyncio.Semaphore(max_concurrent_runs)` | `api/arena.py:77,112` |
| 工具沙箱 | AST 白名单 + 11 个 dunder 黑名单 + 进程级 terminate/kill | `tools.py:97-260` |
| 路径规范化 | 拒绝对路径、`..`、控制字符、Windows 保留名、多点 | `workspace.py:106-130` |
| URL 校验 | 拦截元数据 IP、javascript:、仅 loopback 可走 http | `url_validate.py` |
| 错误脱敏 | `sanitize_error_message` 仅暴露类型名 | `errors.py` |
| Prompt 注入 | 11 条正则 + NFKC 归一化统一来源 | `harness.py:30-46, 56-73` |
| RAG 片段封装 | XML fence + 「不是系统指令」声明 | `context_manager.py:28-37` |
| 工具守卫 | 跑题检测 + 任务锚定注入 | `tool_guard.py` |
| 消息消毒 | thinking 剥离 + SystemMessage 压平 | `message_sanitize.py` |
| 输出截断 | 沙箱 32KB、文件 256KB、计算 4096 位 | `tools.py:39-45, 122-128` |
| 密钥脱敏 | API Key 仅显示 `前4...后4` | `api/settings.py:38-43` |
| CORS 显式列表 | 仅 `cors_origin_list` 白名单 | `config.py:46` |
| CSP 响应头 | 严格 default-src + frame-ancestors none | `next.config.ts:13-30` |
| Frontend 路由级错误边界 | `error.tsx` + `global-error.tsx` | `app/error.tsx, global-error.tsx` |
| 前端 URL 净化 | `safeHttpUrl` 阻止 javascript: | `lib/safeUrl.ts` |
| 前端 Abort 取消 | useEffect 清理 + `AbortController` | `projects/page.tsx:19-34` |
| 前端 SSE 解析 | `streamArenaRun` 优雅处理 Abort | `lib/api.ts:227-308` |

> **评价**：项目对**对抗性安全**的覆盖度**令人意外地高**——远超「个人 Playground」的水平。即使对「单用户本地」场景也做了沙箱与脱敏，向多用户部署的迁移成本主要在 workspace 所有权。

---

## 2. 异步与并发（Concurrency & Async）

### 🟢 已落地的 async 改造（POSITIVE）

- `harness.py:117,155,184` 三函数 `async def` + `await llm.ainvoke`
- `reasoning_graph.py` 全部 8 个节点函数 `async def` + `ainvoke`
- `tools.py` `tool_func.ainvoke`（`reasoning_graph.py:96`）
- `api/settings.py:251,289` `_test_*` 包 `asyncio.to_thread`

### 🟠 M2. `_run_sem` 全局化导致跨请求串行

**位置**：`backend/app/api/arena.py:77`
```python
_run_sem = asyncio.Semaphore(max(1, int(app_settings.max_concurrent_runs)))
```

**问题**：
- `max_concurrent_runs=4`（`config.py:50`）意味着**整个后端**最多 4 个并发 Arena run
- 100 个不同浏览器用户各发 1 个 run → 第 5 个请求会被阻塞，**即使前后端都健康**
- `_run_sem` 是模块级全局，生命周期等同进程；不可按用户/会话配额

**修复建议**（按使用强度选）：
- **A**（最低成本）：文档明确「单用户本地」+ 提供 `MAX_CONCURRENT_RUNS` 环境变量可调到 1
- **B**（推荐）：改为**请求级**信号量，在 `event_generator` 内 `asyncio.Semaphore()` 局部创建，按 IP / session 限流
- **C**（过度设计）：引入 `aiolimiter` 按 endpoint_id 限流，按 `LLM_API_KEY` 计费配额

> **现实**：本项目是单用户本地工具，**A 足够**。但 CLAUDE.md 应明确这是**故意设计**而非遗漏。

---

### 🟡 L1. `runner.py:96-102` `finally` 中 `leaked` 检测无清理动作

**位置**：`backend/app/arena/runner.py:96-102`

```python
finally:
    leaked = [w for w in workers if not w.done()]
    if leaked:
        logger.warning("检测到 %d 个未结束 worker", len(leaked))
```

**问题**：`finally` 检测到 leaked 仅记录日志，**未取消也未等待**。结合 `except` 分支的 cancel + wait 5s，正常路径下不应有 leaked；若出现，日志无操作意义。

**修复建议**：
```python
finally:
    leaked = [w for w in workers if not w.done()]
    if leaked:
        for w in leaked:
            w.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(*leaked, return_exceptions=True), timeout=2
            )
        except asyncio.TimeoutError:
            logger.warning("无法清理 %d 个 worker", len(leaked))
```

---

### 🟡 L2. `WorkspaceManager._lock` 是 `threading.RLock`，但 `Workspace.rag_store` 内部构建无锁

**位置**：`backend/app/arena/workspace.py:255` `_lock = threading.RLock()` vs `workspace.py:84-104` `rag_store()`

**问题**：`WorkspaceManager` 增删改查用 `RLock` 保护；但 `Workspace.rag_store()` 是惰性构建，`_rag_cache` 是普通属性。两 worker 在 SSE 中同时调 `ws.rag_store()`（会经 `context_manager.py:81-88` `maybe_vector_snippets` 触发），理论上存在竞态——**两个 worker 同时见到 `_rag_cache is None`，各自构建一次向量库**。结果不致命（缓存最终会被最后一次写入覆盖），但浪费 CPU 且 `add_documents` 会**重复追加**。

**修复建议**：
- 在 `Workspace` 上加 `threading.Lock` 或直接用 `functools.cache` 装饰 `rag_store`
- 更好的方案：`rag_store` 的计算与文件读取绑定，可将缓存 key 与 `files` 的内容 hash 绑定

---

## 3. 架构与设计（Architecture）

### 🟣 D1. `arena/router.py` 全局可变字典是隐性单例

**位置**：`backend/app/arena/router.py:55-187`

**事实**：
- `_STATIC_DIMENSION_OPTIONS`、`DIMENSION_OPTIONS`、`_BASELINE_OPTION_VALUES`、`DEFAULT_BASE`、`_ENDPOINT_CATALOG` 都是**模块级可变**全局状态
- 通过 `sync_framework_options_from_registry()` / `sync_model_options_from_provider()` / `reset_dimension_options()` 三个函数直接 mutate
- 任何 import `router` 的模块都隐式共享这套状态；测试靠 `reset_dimension_options()` 显式回滚（`conftest.py:24-32` `_reset_provider_cache` 自动 fixture）

**问题**：
- 测试隔离**目前依赖 fixture**，但**没有**运行时校验（`sync_*` 被并发调用时无锁）
- `sync_model_options_from_provider` 在 `lifespan` 中并未显式调用，依赖**首次请求**时 `arena_meta` 触发（`api/arena.py:90-91`）；首次跑模型对比前 `DIMENSION_OPTIONS["model"]` 可能是空
- 跨用户并发：`PUT /api/settings/provider` 调用 `invalidate_provider_cache()` → `sync_model_options_from_provider()` 期间，正在跑的 Arena run 引用旧配置 → 数据竞争

**修复建议**：
- 把 `DIMENSION_OPTIONS / DEFAULT_BASE` 改为**不可变 dataclass** 或 `frozen_mapping` 包装
- 每次 `route()` 调用时显式从 `ProviderConfig` 重建（**当前在 `_base()` 内 `provider = _cached_provider()` 已做，但 `_ENDPOINT_CATALOG` / `DEFAULT_BASE` 仍是全局**）
- 若要保留缓存，必须给所有同步函数加 `threading.RLock` 或 `asyncio.Lock`（按调用线程类型）

> **严重性**：不致命但**耦合性极差**。重构 1 个新维度（如 `toolset` 已加、`temperature` 已加）必须同步改 5 个散落字典（已在 `REASONING_MODES` 注册表模式上有所缓解）。

---

### 🟣 D2. 注册表模式一致性 — `router.py` vs `reasoning_graph.py` 风格不统一

**位置**：
- `reasoning_graph.py:357-403` 已有 `ReasoningModeSpec` dataclass 注册表，**优秀**
- `router.py` 仍有 `_STATIC_DIMENSION_OPTIONS` / `_BASELINE_ONLY_OPTIONS` / `_BASELINE_ONLY_LABELS` / `_FIELD_LABELS` / `_FIELD_GROUP` **5 个平行字典**

**建议**：抽取 `DimensionSpec` dataclass，字段含 `id / field / label / group / options / default_snap_fn`；`router.py` 改为
```python
DIMENSION_SPECS: dict[DimensionId, DimensionSpec] = {
    "framework": DimensionSpec(..., options=FRAMEWORK_OPTIONS, snap_fn=None),
    "temperature": DimensionSpec(..., snap_fn=_snap_temperature),
    ...
}
```

这一改动可**消除** ~150 行平行数据，把 `list_baseline_fields` / `_baseline_default_token` / `_rebuild_baseline_option_values` 缩为 ~30 行。

---

### 🟣 D3. `FrameworkAdapter` Protocol 的 `if False: yield` 技巧

**位置**：`backend/app/adapters/base.py:21-40`

```python
async def run(self, question, config, *, history=None) -> AsyncIterator[ArenaEvent]:
    if False:  # pragma: no cover - 仅类型标注用途
        yield
```

**事实**：这是 mypy + Protocol 的已知兼容性 hack（`@runtime_checkable` + async generator 协议无标准表示）。作者已加注释解释。

**问题**：注释**写得对**但**理由没说透**——可以补一句「mypy 不会识别 `async def` 自身为 `AsyncIterator[ArenaEvent]`，必须显式 `yield` 一次」。

**修复建议**（可选）：在 `from typing import AsyncGenerator` 后改签名为 `AsyncGenerator[ArenaEvent, None]`，可避免 hack：

```python
from typing import AsyncGenerator
async def run(
    self, question, config, *, history=None
) -> AsyncGenerator[ArenaEvent, None]:
    if False:
        yield
    raise NotImplementedError
```

差异不大，但「**hack + 注释**」vs「**显式类型**」二选一。

---

## 4. 代码复用度（Reusability）

### 🟠 M3. 工具 `tool_call_id` 与 `prior_names` 计算在两个地方重复

**位置**：
- `adapters/langchain_adapter.py:67-105`（`_ArenaContextMiddleware._decide_block` 内 prior 计算）
- `arena/reasoning_graph.py:64-79`（`_react_tool_node` 内 prior 计算）

两处都在做**几乎一样**的「从历史消息收集 prior tool names」逻辑，但一处用 `request.state`，一处用 `state.get("messages")`。

**修复建议**：在 `adapters/_common_run.py` 新增 `collect_prior_tool_names(messages) -> list[str]`，两处共用。

---

### 🟠 M4. `prompts.py` 与 `context_manager.py` 都有 `maybe_vector_snippets` 入口

**位置**：
- `arena/prompts.py:62-72`（间接 import `from app.arena.context_manager import format_retrieved_snippets, maybe_vector_snippets`）
- `arena/context_manager.py:73-108`（实际定义）

`prompts.py` 已经在复用 `context_manager.maybe_vector_snippets`，**但仍保留** `_CONTEXT_HINTS` 字典（在 `prompts.py:42-49`）作为冗余 hint。**OK**，提示本身合理。

**建议**：将 `prompts._CONTEXT_HINTS` 合并到 `context_manager.CONTEXT_HINTS`，让 prompts 只关心 prompt profile（提示策略），context 字典归 context_manager 管。

---

### 🟡 L3. `emit_harness_event` 与 `emit_stream_event` 中 `streaming_step` 收尾逻辑重复

**位置**：`adapters/_common_run.py:140-152, 184-192, 240-252, 259-271`

4 处都在做"if state.streaming_step is not None: emit thought_end, set to None"。

**修复建议**：抽取 `_close_streaming(state, label) -> list[ArenaEvent]` 私有函数。

---

## 5. 前端质量（Frontend Quality）

### 🟠 M5. `ArenaClient.tsx` 1620 行巨型客户端组件

**位置**：`frontend/src/app/arena/ArenaClient.tsx`（**1620 行**）

**问题**：
- 单一组件承担：URL 参数解析、Meta 拉取、模板加载、模板选择、维度选择、Baseline 编辑、Chat 历史管理、Run 状态机、SSE 解析、Trace 渲染编排、自动判分、项目创建、两个侧栏开关、12+ 内部 hook
- 任何小改动（按钮文案、动画时长）都需要编辑 1620 行文件
- 单元测试困难（`test_frontend_session_contracts.py` 仅测试契约，不测试 UI）

**修复建议**（按重构深度选）：
- **A（最小）**：抽出 `useArenaRun` 自定义 hook（封装 SSE / 状态机 / 判分） → 100-200 行剥离
- **B（推荐）**：再抽 `useArenaMeta` `useChatHistory` `useTemplates` 三个 hook → 主组件剩 800 行左右
- **C（重）**：拆为 5-7 个组件（`<DimensionPicker>` `<RunBar>` `<RunColumns>` `<TraceView>` 已存在 `<ProjectCreateDialog>`）→ 主组件剩 200 行编排

> **注**：CLAUDE.md §5 写「状态管理只用 React 内置 hooks」——**A/B 方案兼容**，C 方案**不引入新依赖**（都是 React + 现有组件）。

---

### 🟡 L4. `globals.css` 3998 行自定义类，缺乏分章节注释

**位置**：`frontend/src/app/globals.css`（3998 行）

**事实**：
- 已有 1 个顶部注释 `@import "tailwindcss";` + 17 行顶部 doc
- 4KB 的 CSS 全文**没有任何 `/* ===== Section ===== */` 分章节注释**
- 类名如 `arena-module-*` `arena-chrome-*` `arena-setup-*` `panel-*` `seg-tab` `btn-*` 散落
- 找一个类需要全文 grep

**修复建议**：在 CSS 顶部加章节大纲（不实际改动文件，仅在报告中提议）：
```
/* ===== 0. Token ===== */
/* ===== 1. Reset / Base ===== */
/* ===== 2. Brand & Header ===== */
/* ===== 3. Buttons & Inputs ===== */
/* ===== 4. Panels & Surfaces ===== */
/* ===== 5. Arena 专用 ===== */
/* ===== 6. Trace / Diff ===== */
/* ===== 7. Animations ===== */
/* ===== 8. Dark theme overrides ===== */
```

> **注**：CLAUDE.md §"前端" 写"CSS 类定义在 globals.css，不在 JSX 写 style" — 风格统一，**不要拆文件**。

---

### 🟡 L5. `noUncheckedIndexedAccess` 已开启，但前端 SSE 解析仍做 4 处 unchecked access

**位置**：
- `frontend/src/lib/api.ts:264` `eventName` 状态变量在闭包内多次写入，作用域有点绕
- `frontend/src/lib/api.ts:289` `dataLines.join("\n").trim()` 在 `dataLines.length === 0` 时仍 return

**问题**：未崩溃但有边界条件分支不清晰。

**修复建议**：把 SSE 解析抽为 `parseSSEBlock(block) -> string | null` 纯函数（带测试）。

---

### 🟢 前端亮点（POSITIVE）

| 模块 | 评价 | 位置 |
|---|---|---|
| `safeHttpUrl` | 阻止 javascript: 点击 XSS | `lib/safeUrl.ts` |
| `streamArenaRun` AbortSignal 贯穿 | 用户停止时立即断开 | `lib/api.ts:227-308` |
| 路由级 + 全局错误边界 | Next 16 新约定 | `app/error.tsx, global-error.tsx` |
| 设计 token 完整 | 颜色 / 间距 / 圆角 / 缓动 / 阴影 | `globals.css:1-100` |
| CSP 头 + Permissions-Policy | 安全响应头齐全 | `next.config.ts:13-30` |
| TS 严格度 | `noUncheckedIndexedAccess` + `noImplicitOverride` | `tsconfig.json:11-12` |
| `tsc --noEmit` 进 CI | 类型门禁 | `ci.yml` |
| 同源 `/api/*` 代理 | 避免 CORS 复杂度 | `next.config.ts:35-41` |

---

## 6. 依赖与配置（Dependencies & Config）

### 🟠 M6. `requirements.txt` 与 `pyproject.toml` 重复且不一致

**位置**：
- `backend/requirements.txt:14` `langchain-openai>=0.2.0` ← `pyproject.toml:18` `>=0.3.0`
- `backend/requirements.txt:16` `openai>=1.0.0` ← `pyproject.toml:20` `>=1.40.0`
- `requirements.txt:1-17` 与 `pyproject.toml:11-21` 几乎完全重复

**问题**：
- 两份文件必须**手动同步**；CI 用 `pip install -e ".[dev]"`（走 pyproject），本地用 `pip install -r requirements.txt`（走 txt）
- 已存在版本漂移（langchain-openai、openai）

**修复建议**：
- **删除** `requirements.txt`，让所有路径走 `pip install -e ".[dev]"`（已在 README §"后端启动"中作为可选）
- 或将 `requirements.txt` 改为「`pip install -e ".[dev]"` 引导注释 + 锁定文件 `requirements.lock`」

---

### 🟡 L6. `pyproject.toml` Python 版本声明三处不一致

**位置**：
- `pyproject.toml:6` `requires-python = ">=3.11"`
- `pyproject.toml:25` `target-version = "py310"`（**Ruff**）
- `ci.yml:11` `python-version: "3.14"`
- `README.md` §"环境要求" `Python 3.10+`
- `CLAUDE.md:11` `Python 3.11+`

**建议**：
- `pyproject.toml:25` 改为 `target-version = "py311"`（与 `requires-python` 对齐）
- `README.md` 改为 `Python 3.11+`
- 实际验证：CI 用 3.14，dev venv 是 3.14.6

---

### 🟡 L7. `pyproject.toml` 关闭 `F841 F821 B905`

**位置**：`pyproject.toml:28-33`
```toml
ignore = [
    "F841",  # local variable assigned but never used
    "F821",  # undefined name (在 from __future__ import annotations 下大量误报)
    "B905",  # zip() without explicit strict= 参数
]
```

**问题**：
- `F841`（unused local var）是**重要信号**——批量关闭会掩盖 bug。例如 `result = await ...` 但忘了用
- `B905` 在 Python 3.10+ 是真实风险（`zip(a, b)` 不带 `strict=` 可能漏数据）
- `F821` 在 `from __future__ import annotations` 下确有误报，但应当**逐文件加 noqa** 而非全局关闭

**修复建议**：
- 开启 `F841`，对**确实需要**保留的变量加 `# noqa: F841` + 注释理由
- 开启 `B905`，对故意不等长的 zip 加 `# noqa: B905` + 理由
- 保留 `F821` 关闭（Python 3.12 之前 from __future__ import annotations 确实存在大量误报）

---

## 7. 测试与质量门禁（Testing & Quality Gate）

### 🟢 测试体系（POSITIVE）

- **38 个测试文件 / 344 个 test_**（`tests/test_*.py`）
- 覆盖：LLM 工厂、Provider 配置、Workspace TTL/LRU、Tool 安全 / 沙箱逃逸、消息消毒、Tool guard、模板库、判分器、Reasoning 图、Harness Runner、Token 估算、URL 校验、请求体大小中间件、Project Manager、Router、Settings API
- 沙箱安全测试 `test_sandbox_security.py:26` 用例（`test_no_import_access`、`test_no_open_builtin`、`test_no_exec`、`test_no_eval`、`test_no_subprocess`）
- `conftest.py` 自动 fixture（`isolated_projects_file`、`isolated_provider_file`）保证测试隔离
- CI 5 步门禁：`ruff → mypy → pytest → tsc → npm run build`

---

### 🟠 M7. `test_provider`（settings API）始终无测试

**位置**：仓库根无 `tests/test_settings_api.py`

**问题**：尽管 `api/settings.py` 的 `_test_anthropic` / `_test_openai` 已被改造为线程池（修复了 S1），但**没有任何测试**覆盖：
- GET `/api/settings/provider` 返回脱敏 key
- PUT 保留空 api_key
- POST `/test` 的成功/失败路径
- 异常路径（如 `anthropic.Anthropic=None` 时如何处理）

**风险**：上轮审查发现的阻塞事件循环问题**就是因无测试而漏过**——直到代码层面看到才修。

**修复建议**：新增 `tests/test_settings_api.py`（约 80-120 行），用 `pytest-mock` 或 `unittest.mock` patch `anthropic.Anthropic` 与 `openai.OpenAI` 的 `.create`，覆盖：
- 成功路径返回 `ConnectionTestResult(ok=True)`
- 异常路径返回 `ConnectionTestResult(ok=False, message="连接失败: <ExceptionType>")`
- `api_key=""` 时返回 400「请先填写 API Key」
- 测试 Provider 端点 800ms 完成（不阻塞事件循环）

---

### 🟡 L8. `runner.py:55-100` `stream_parallel` 端到端测试缺失

**位置**：`backend/app/arena/runner.py` 核心调度逻辑无独立测试

**事实**：`tests/test_runner.py` 存在但测试 `arena/runner.py` 自身很薄（多测试在测试 adapter 或 build_registry）。

**建议**：增加：
- 并发取消：mock adapter 抛 `asyncio.CancelledError`，验证 worker 都被 cancel
- 部分失败：3 个 worker 中 1 个抛异常，验证其余 2 个正常完成且 SSE 仍收到 `complete` 事件
- `AdapterReservedError` 路径：mock 一个 reserved 框架，验证收到 `error` + `complete(success=False)` 配对

---

## 8. 文档与可维护性（Docs & Maintainability）

### 🟡 L9. `CLAUDE.md` 与实际代码漂移

**位置**：`CLAUDE.md:11` `Python 3.11+`（OK）vs `pyproject.toml:6` `>=3.11`（OK）vs `pyproject.toml:25` `target-version = "py310"`（**不一致**）vs `README.md:35` `Python 3.10+`（**不一致**）

详见 L6。

---

### 🟡 L10. `docs/ARCHITECTURE_REVIEW.md` 未提交但已存在

**位置**：`docs/ARCHITECTURE_REVIEW.md`（git status 显示未跟踪）

**事实**：
- 已有 `docs/CODE_REVIEW.md` 与 `docs/AGENT_CODE_REVIEW.md` 两份审查
- 又有 `docs/ARCHITECTURE_REVIEW.md` 在工作区但未跟踪
- 三份审查结论**相互独立**，读者困惑以哪份为准

**建议**：
- 决定归档策略：在 README §"开发约束" 引用最新一份 + 标注日期
- 删除过时版本（与当前代码不一致的部分）

---

## 9. 修复优先级总览

### 批次 1（HIGH，必须）
| 编号 | 标题 | 文件 | 工作量 |
|---|---|---|---|
| **H1** | 撤销 .env 真实 Key、删除 .env 文件 | `.env`, `CLAUDE.md` | 极小 |

### 批次 2（MEDIUM，建议）
| 编号 | 标题 | 文件 | 工作量 |
|---|---|---|---|
| M1 | workspace 端点增加多用户部署警告 | `api/arena.py` | 极小 |
| M2 | 文档化 `_run_sem` 设计意图 | `CLAUDE.md` | 极小 |
| M3 | `collect_prior_tool_names` 抽公共函数 | `adapters/_common_run.py`, `langchain_adapter.py`, `reasoning_graph.py` | 小 |
| M4 | `CONTEXT_HINTS` 归口 `context_manager.py` | `arena/prompts.py`, `arena/context_manager.py` | 小 |
| M5 | `ArenaClient.tsx` 抽 `useArenaRun` hook | `frontend/src/app/arena/ArenaClient.tsx` | 中 |
| M6 | 删除 `requirements.txt` 走 pyproject | `backend/requirements.txt` | 极小 |
| M7 | 新增 `test_settings_api.py` | `tests/` | 小 |

### 批次 3（LOW，可选）
| 编号 | 标题 | 文件 | 工作量 |
|---|---|---|---|
| L1 | `runner.py` finally 补 cancel | `arena/runner.py` | 极小 |
| L2 | `Workspace.rag_store` 加锁 | `arena/workspace.py` | 小 |
| L3 | `_close_streaming` 抽函数 | `adapters/_common_run.py` | 极小 |
| L4 | `globals.css` 加章节注释 | `frontend/src/app/globals.css` | 极小 |
| L5 | SSE 解析抽 `parseSSEBlock` 纯函数 | `frontend/src/lib/api.ts` | 小 |
| L6 | Python 版本声明三处对齐 | `pyproject.toml`, `README.md` | 极小 |
| L7 | 重开 `F841` `B905` | `pyproject.toml` | 小 |
| L8 | `stream_parallel` 补端到端测试 | `tests/test_runner.py` | 小 |
| L9 | 文档与代码漂移修复 | 多文件 | 极小 |
| L10 | 归档策略：保留最新一份审查 | `docs/` | 极小 |

### 批次 4（DESIGN，建议决策）
| 编号 | 标题 | 文件 | 工作量 |
|---|---|---|---|
| D1 | router 全局可变状态冻结 | `arena/router.py` | 中 |
| D2 | 抽 `DimensionSpec` dataclass | `arena/router.py` | 中 |
| D3 | `FrameworkAdapter` 改 `AsyncGenerator` 显式签 | `adapters/base.py` | 极小 |

---

## 10. 给用户的最终建议

1. **立即**：处理 H1（撤销 Key + 删 `.env`），这是唯一**对外暴露的真实风险**
2. **本 PR** 处理 M1 / M2 / M6（极小改动 + 文档化）
3. **下个 Phase** 处理 M3 / M4 / M5 / M7（中等重构 + 测试）
4. **下次大重构**处理 D1 / D2（架构层）

不要因为报告长就推迟小改动 — 多数 MEDIUM 项是**半小时以内**可落地的「扫尾型」修复。

---

## 11. 附录：复核既有审查的修复状态

| 编号 | 标题 | 状态 | 证据 |
|---|---|---|---|
| S1 | test_provider 同步阻塞 | ✅ 已修 | `api/settings.py:251,289` `asyncio.to_thread` |
| C1 | LLM 同步调用阻塞事件循环 | ✅ 已修 | `harness.py:117,155,184`, `reasoning_graph.py` 全部 async |
| S2 | workspace 多点/Windows 保留名 | ✅ 已修 | `workspace.py:52,121` |
| Q1 | EventType 重复 | ✅ 设计意图 | `types.py:43-58` |
| Q3 | adapter run() 抽公共基类 | ✅ 已抽 | `adapters/_common_run.py` 289 行 |
| S3 | workspace API 越权 | ⚠️ 文档化已做，**代码层未动** | `arena.py:115-117` 注释 |
| S4 | _check_regex ReDoS | ✅ 已有 `answer[:2000]` 截断 | `judging.py:171-178` |
| E2 | 推理模式注册表统一 | ✅ 已抽 | `reasoning_graph.py:357-403` `ReasoningModeSpec` |
| D1 | Python 版本声明对齐 | ⚠️ 部分漂移仍存 | 见 L6 |
| T3 | settings API 测试 | ❌ 仍无 | 无 `tests/test_settings_api.py` |

**结论**：既有 `AGENT_CODE_REVIEW.md` 标记的 4 个 HIGH 全部修复，6 个 MEDIUM 中 4 个修复，2 个部分（仅文档化）。这份新报告是**补充而非重复**——聚焦于**新发现的 H1（Key 泄露）、D1-D3（架构层）以及 10 个 LOW 改进**。

---

*报告生成于 2026-08-04，仅作审查；本报告未修改任何项目代码。*
