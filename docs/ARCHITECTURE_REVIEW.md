# AgentPrism 架构与设计审查报告

> **审查范围**：`754574d..HEAD`（8 个提交）的架构与设计层面 + 项目整体架构
> **审查日期**：2026-08-04
> **审查基线**：main 分支 commit `754574d` → `d04b431`（8 个提交：安全闭环 / 解码基线 / Vercel 重设计 / 多轮对话 / 动效打磨）
> **审查方式**：4 路并行深度审查（安全 / 后端核心 / 配置 API / 前端）+ 关键发现逐项实测核实 + 验证链实跑
> **验证状态**：pytest **5 失败**；mypy **3 错误**（详见 §4）
> **结论先行**：整体架构方向正确（分层清晰、扩展点设计良好），但存在 **CI 验证链已红**、**API Token 功能半成品**、**安全校验存在可复现绕过** 三类必须处理的问题。

---

## 0. 总体评价

这 8 个提交的功能体量很大（多轮对话、思考强度维、Vercel 重设计、双抽屉动效、指南页），**核心抽象设计质量高**：维度控制变量模型、适配器注册表、事件翻译共享层、ContextVar 隔离、纵深防御分层都经得起推敲；测试数量明显增加（新增 `test_chat_history` / `test_thinking` / `test_toolset_dimensions` / `test_url_validate` 等）。

但 **「提交即验证链红」是不可接受的发布状态** —— 5 个 pytest 失败 + 3 个 mypy 错误意味着 CI 一直在报错而提交照推，这比任何单个 bug 更伤项目健康。其次是 API Token 半成品与两处安全校验绕过。

**证据标记约定**：
- ✅ **已核实** — 主 agent 亲自复现/验证过
- ⚠️ **报告中指出** — 子 agent 报告，未逐一复现

严重程度图例（沿用 `AGENT_CODE_REVIEW.md` 惯例）：
- 🔴 **HIGH** — 影响功能正确性/安全性/稳定性，必须修
- 🟠 **MEDIUM** — 影响可维护性/健壮性，建议修
- 🟡 **LOW** — 规范性/一致性优化，可选修

---

## 1. 总体架构概览

```
┌─ Frontend (Next.js 15 / React 19) ─────────────────────────────┐
│  arena/ArenaClient.tsx (1620行) ←── SSE fetch 流式消费          │
│  components/{TraceView, TraceDiff, ExperimentPanel, ...}        │
│  lib/api.ts ──── 契约类型 + 全部 HTTP 调用                       │
└──────────────┬─────────────────────────────────────────────────┘
               │ REST + SSE (EventSourceResponse)
┌──────────────▼─────────────────────────────────────────────────┐
│  API 层        main.py (中间件/CORS/DoS)                       │
│                api/{arena, settings}.py                         │
│                models.py — 全部 Pydantic 契约                   │
├────────────────────────────────────────────────────────────────┤
│  编排层        arena/runner.py  RunnerPool（并发 worker）       │
│                arena/router.py  维度路由/基线解析 (564行)       │
│                arena/reasoning_graph.py 图构建 (REASONING_MODES)│
│                arena/harness.py  HarnessRunner                  │
│                arena/thinking.py 思考强度→budget 映射           │
│                arena/{context_manager, tool_guard, toolset}     │
├────────────────────────────────────────────────────────────────┤
│  适配器层      adapters/base.py  FrameworkAdapter Protocol      │
│                adapters/_common_run.py  共享事件翻译层 (去重)   │
│                adapters/{langchain, langgraph}_adapter.py       │
├────────────────────────────────────────────────────────────────┤
│  基础设施      arena/workspace.py (ContextVar 隔离)             │
│                arena/llm.py (多接入点), tools.py (AST沙箱)      │
│                config.py / storage.py / url_validate.py         │
└────────────────────────────────────────────────────────────────┘
```

**数据流**：`ArenaRunRequest → RunnerPool 拆分为每列一个 PipelineConfig → worker 并发跑 adapter.run() → 事件经 _common_run 翻译 → SSE 合并流 → 前端按 turn 归并进 ColumnState → 完成后 extractFinalAnswer 提交多轮历史`

---

## 2. 架构亮点（值得肯定的设计）

| # | 设计 | 位置 | 说明 |
|---|---|---|---|
| ✅ 1 | 维度控制变量模型 | `types.py` + `PipelineConfig` + `BaselineOverrides` | 维度枚举以 `Literal` 单一来源定义，`DimensionRouter.route()` 负责「仅切维度、其余由基线固定」—— Arena 产品的核心抽象，测试覆盖到位（`test_toolset_dimensions.py` 验证工具集真实绑定） |
| ✅ 2 | FrameworkAdapter Protocol + 注册表 + reserved 机制 | `adapters/base.py` | 新框架接入只需实现 `run()` 并注册；`_common_run.py` 把两适配器重复逻辑（workspace 创建、事件翻译、finish 事件）抽成共享层，去重彻底 |
| ✅ 3 | `REASONING_MODES` 注册表 | `reasoning_graph.py:352` | 四种推理模式的元数据集中管理，扩展新推理模式成本低 |
| ✅ 4 | 纵深防御分层 | 工具护栏→AST 沙箱→workspace 路径→URL 校验 | 错误回显一律 `sanitize_error_message` 仅暴露类型名，防密钥泄露设计到位 |
| ✅ 5 | ContextVar 工作空间隔离 + 测试 override | `workspace.py` | 用 contextvars 而非 threading.local（asyncio 任务跨线程调度时 threading.local 会丢上下文）；override 机制贯通工具层（`tools.py:_get_ws` 经 `get_workspace_mgr()`） |
| ✅ 6 | storage 原子写 + 权限收紧 | `storage.py` | tmp+fsync+`os.replace` 原子替换，目录 `0o700`/文件 `0o600`（best-effort） |

---

## 3. 架构层面问题（按严重度排序）

### 🔴 A1. CI 验证链已红 —— 代码与测试契约漂移 ✅已核实（最紧急）

pytest 5 个失败、mypy 3 个错误，推送到三远端的 8 个提交会让 CI（`.github/workflows/ci.yml` backend-test job）直接失败：

| 失败项 | 根因 |
|---|---|
| `test_runner.py` ×3 | `runner.py:114-117` 已按新 Protocol 传 `history=` 关键字，但 `test_runner.py` 的 stub adapter `run()` 签名未更新 → `TypeError: unexpected keyword argument 'history'` |
| `test_arena_run_contract.py` ×1 | 同上，`_FakeAdapter.run()` 未接 `history` |
| `test_frontend_session_contracts.py::test_traceview_uses_stable_thought_key` ×1 | 契约测试断言 `thought:${step}` 字样，但 TraceView 已重构为其它 key 写法（grep 型测试的典型假性失败） |
| `mypy: router.py:470/478` | 类型不匹配 `list[tuple[str,str]]` vs `list[tuple[str,str,str]]` |
| `mypy: config.py:116` | Unused `type: ignore` |

**架构含义**：Protocol 是静态类型契约，`runtime_checkable` 的 `isinstance` 只查属性存在、不查 `run` 签名。stub 不受 Protocol 约束，运行时才炸——**契约的真实载体是测试，而测试没跟上**。适配器接口演进缺少强制同步机制（如 conformance test suite 或注册时 `inspect.signature` 校验）。

**修复建议**：更新两个测试文件的 stub `run()` 签名加 `history` 参数；修 mypy 3 错误；`test_frontend_session_contracts` 断言改为与当前实现一致（或重构为行为测试）。

### 🔴 A2. API Token 功能是半成品 ✅已核实

- `main.py:181-192`：Starlette 中间件 LIFO，`ApiTokenMiddleware` 后添加先执行，位于 CORSMiddleware **之前**。启用 `AGENTPRISM_API_TOKEN` 后，浏览器 CORS 预检（OPTIONS）会被 401 挡死。
- `frontend/src/lib/api.ts` 全文**没有任何 Authorization/X-API-Token 头**——即便预检通过，实际请求也 401。
- `main.py:159-161` 用 `==` 比较 token（非恒定时间，轻微）。

**架构含义**：token 认证在「后端有、前端无、中间件顺序错」三处断裂，属功能未完成就提交。要么补完（前端发 token + 中间件对 OPTIONS 放行 + `secrets.compare_digest`），要么明确标注「未启用」。

### 🔴 A3. 安全校验存在可复现绕过 ✅已核实

| 项 | 复现结果 | 影响 |
|---|---|---|
| **S1 编码 IP 绕过** `url_validate.py:40-54` | `https://2852039166/...`（十进制=169.254.169.254）与 `https://0xA9FEA9FE/...`（十六进制）**均通过** `validate_llm_base_url`；字面量 `169.254.169.254` 正确拦截 | 元数据/链路本地段拦截可被编码表示绕过 |
| **S2 盘符绝对路径** `workspace.py:106-126` | `C:/foo/bar`、`D:/secret.txt` 通过 `_normalize` | 路径校验宣称拦截绝对路径，实际只拦 `/`、`\` 开头 |
| **S3 子目录保留设备名** `workspace.py:52,121` | `subdir/CON`、`foo/CON.`、`subdir/NUL` 全部放行 | 保留名检查只匹配路径首段 |
| **S4 base_url 加载路径绕过校验** `config.py` vs `models.py:197-202` | `validate_llm_base_url` 只在 `LlmEndpointUpdate`（API 写入路径），`config.LlmEndpoint` 无校验器；`load_provider_config()` 直读 JSON 构造 endpoint，绕过校验 | API 层拦截 ≠ 加载层拦截 |

**架构含义**：校验逻辑分散在 API 模型（`LlmEndpointUpdate`）与加载模型（`config.LlmEndpoint`）两套模型上，**校验规则没有下沉到唯一事实源**。任何新入口（配置文件、未来 API）都可能绕过。正确做法是把校验器放到两处共享的 `LlmEndpoint` 本身，或抽出独立校验函数在加载层强制调用。

**威胁模型说明**：base_url 是用户自己在 Settings 设置的（单用户本地部署），S1/S4 主要是「校验完整性」问题而非外部攻击面；但 S2/S3 的路径会被持久化到 `projects.json` 并回显给 LLM，属设计缺陷。

### 🟠 B1. 配置读取存在三条路径、无单一缓存 ✅已核实

- `router.py:304-307` `_cached_provider()`（lru_cache）有缓存
- `llm.py:53` 和 `_common_run.py:68,96` 直调 `load_provider_config()` **每次读盘**、无缓存
- `reasoning_graph.py:18` 每个图节点都 `create_chat_model()` → 每节点读盘一次；Harness 重试路径同样

**架构含义**：同一配置事实存在「缓存/直读」两条路径。热路径被同步磁盘 I/O 反复阻塞（7 个图节点 × N 列并发 × Harness 重试）；而「改了配置立即生效」又依赖直读路径的隐式行为——双向都是坑。应统一到单一 `ProviderConfig` 加载器 + 显式失效。

### 🟠 B2. 前端 ArenaClient.tsx 1620 行 —— 职责过载 ✅已核实

单一组件同时承担：13+ 个 state、SSE 流管理、turn 推导、多轮历史提交、模板/判分、项目保存、双抽屉 UI、URL 预填。**已证实的两个用户可见 bug 都源于此**：

1. `cancelRun`（`:699`）保留上轮 `metrics` → `allCompleted` 误判 → history-commit 副作用（`:803`）把上轮答案写入多轮历史，**污染对话**。
2. `saveAsProject` 按钮（`:1496`）`disabled={!question.trim()}`，而 history-commit effect（`:815`）已 `setQuestion("")` → **运行完成后创建项目按钮永远禁用**，且 `saveAsProject`（`:835`）会传空 question 给后端。

**架构含义**：状态（columns/chatHistory/turn）与副作用（history-commit effect）同处一个巨型组件，彼此经 ref 隐式耦合（`awaitingHistoryCommit.current`、`currentTurnRef.current`）。建议把「多轮历史提交」抽成独立 reducer/hook，SSE 消费抽成 hook，组件只做编排。

### 🟠 B3. 多轮历史的 turn 推导双端重复 ✅已核实

前端 `Math.floor(chatHistory.length / 2) + 1`（`ArenaClient.tsx:719`），后端 `(len(request.messages) // 2) + 1`（`runner.py:120,128,147` 三处重复）。两端各有一份「消息对数 → turn」推导，且 `ChatMessage` 只含 `role/content`，**工具调用轮次在多轮历史中丢失**（`_common_run.py:28-46` 只还原 Human/AIMessage）。⚠️ 对要求 `tool_calls→tool_result` 严格配对的 Anthropic 协议，续聊时可能 400。

**架构含义**：turn 是前后端对齐的契约关键，推导逻辑应后移为单一来源（如后端在 run 响应显式回传 turn，前端不再自行计算）；多轮历史的「纯文本化」取舍应在 PRD/文档中明确声明。

### 🟠 B4. 思考强度维的 provider 行为不一致 ⚠️报告中指出

- Anthropic 路径：`thinking.py:46-54` 会把 `max_tokens` 强制抬升到 `budget+1024`
- OpenAI 路径：`llm.py:116-117` 不抬升 max_tokens，但 `extra_body` 里塞 `budget_tokens`
- 用户显式设 `max_output_tokens=2048` 时，思考维对比会静默变成各列 max_tokens 不同 → **「控制变量」被破坏**

**架构含义**：`thinking.py` 的抽象（level→budget 映射）是对的，但「抬升」副作用落在适配器集成处、且两 provider 不一致。应把「budget vs max_tokens 冲突」处理统一收口到 `llm.py` 单一位置。

### 🟡 C1. 其它设计层面问题

| 项 | 位置 | 严重度 | 说明 |
|---|---|---|---|
| 双框架递归上限不一致 | `langchain_adapter.py:187` `max(25, steps*4)` vs `langgraph_adapter.py:72` `max(50, steps*5)` | 🟡 | 框架维对比的隐性变量 |
| 前端契约测试是 grep 型 | `test_frontend_session_contracts.py` 全文件 | 🟡 | 本次已实际假性失败；建议改为行为测试 |
| TraceDiff 差异高亮过度 | `TraceDiff.tsx:104-113` | 🟡 | 任一列不同则全部标黄，对比核心价值受损 |
| 注入检测误杀 | `harness.py:34-46` 的 `扮演`/`你现在是` 模式 | 🟡 | 正常中文表达会误判注入触发重试 |
| 失败补发 complete 缺 workspace | `runner.py:137-144,157-164` | 🟡 | 与成功路径不一致，失败列无法展示工作空间 |
| `_smoke_arena.py` + `_smoke_artifacts/` | 仓库根目录未跟踪文件 | 🟡 | 临时冒烟脚本未进 .gitignore |
| Token 比较非恒定时间 | `main.py:159-161` | 🟡 | 建议 `secrets.compare_digest` |
| 测连 client 未显式关闭 | `settings.py:255-323` | 🟡 | httpx 连接依赖 GC |
| `summarize_text` 无输入长度上限 | `tools.py:464-473` | 🟡 | 建议加 `max_length` 上界 |

---

## 4. 验证链现状 ✅已实跑

| 检查 | 结果 |
|---|---|
| pytest | ❌ 5 failed（`test_runner`×3、`test_arena_run_contract`×1、`test_frontend_session_contracts`×1） |
| mypy | ❌ 3 errors（`router.py:470,478`、`config.py:116`） |
| ruff | 未复跑（上轮基线通过） |
| tsc / npm build | 未执行 |

⚠️ CI 的 backend-test job 在 `main` push 时触发，以上失败会直接红掉 CI。

---

## 5. 演进建议（按优先级）

**P0 — 修复验证链（半天内）**
1. 更新 `test_runner.py` / `test_arena_run_contract.py` 的 stub `run()` 签名加 `history` 参数
2. 修复 mypy 3 个错误（router.py 的 tuple 类型、config.py 的 unused-ignore）
3. 修 `test_frontend_session_contracts` 断言（或改为行为测试）

**P1 — 功能完整性**
4. API Token：前端发 token 头 + 中间件对 OPTIONS 预检放行（或明确标注未启用）
5. 前端 `cancelRun` 清 metrics、`saveAsProject` 用暂存的 question（修复两个已证实的用户可见 bug）

**P2 — 安全校验收口**
6. 把 `validate_llm_base_url` 下沉到 `config.LlmEndpoint`（S4）
7. workspace `_normalize`：每段检查保留设备名 + 拦盘符（S2/S3）
8. `_is_blocked_ip` 增加编码 IP 归一化（S1）

**P3 — 架构债（择机）**
9. Provider 配置读取统一单一缓存
10. ArenaClient 拆分（多轮历史 reducer + SSE hook）
11. turn 推导单一来源；多轮历史工具轨迹取舍文档化

---

## 6. 结论

核心抽象设计质量高（维度控制变量模型、适配器注册表、事件翻译共享层、ContextVar 隔离、纵深防御分层），功能体量大且测试覆盖明显增强。但当前状态不可直接合入/发布：**CI 验证链已红**（A1）、**API Token 半成品**（A2）、**安全校验可复现绕过**（A3）三项必须处理；其余为架构演进项。

主 agent 判断：A1 不涉及设计变更、半小时内可完成，应优先；A2/A3 是功能与安全完整性；P3 各项可择机演进。
