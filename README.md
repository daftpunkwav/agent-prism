# AgentPrism

> 同一个问题，多条管线受控并行，差异可量化、可复现。

**AgentPrism** 是一个 Agent 对比实验台（Arena）。用户输入一个问题或任务，系统同时启动多条 Agent 管线并行运行，实时流式展示每个 Agent 的推理过程、工具调用、中间结果，最终汇总对比报告。

就像一束白光穿过棱镜折射出光谱——一个问题，折射出 Agent 的万千可能。

## 为什么需要 AgentPrism

学 Agent 开发最大的痛点：**框架太多，不知道选哪个；模式太多，不知道差在哪。**

- LangChain、LangGraph、AutoGen、CrewAI……文档各看一遍，还是不会选
- ReAct、CoT、ToT、Reflexion……概念都懂，但跑起来到底有什么区别？
- Harness Engineering、Loop Engineering……2026 最前沿的概念，没有项目实践过

AgentPrism 的答案：**同一个问题，多条管线并行跑，差异一目了然。**

## 核心功能

### Arena 实验台

- **五维度对比**：框架 / 提示词 / 推理模式 / 上下文策略 / Harness
- **实时流式输出**：打字机效果渲染 Agent 推理过程，支持 Markdown
- **工具调用展示**：文件操作折叠预览、代码执行代码块、参数格式化
- **对比报告**：耗时 / Token / 工具调用 / 步骤数硬指标对比表格 + 最快/最省标记
- **Trace 对比**：按 step 对齐各列事件，差异高亮（TraceDiff 组件）
- **Agent 工作空间**：每个 Agent 独立文件系统（路径规范化 + TTL/LRU），实时文件浏览器侧栏
- **项目管理**：从 Arena 运行结果一键创建项目，保存工作空间和对比结果

### 对比维度

| 维度 | 列数 | 实现位置 | 说明 |
|------|------|----------|------|
| 框架 | 2 | `arena/router.py` + `adapters/{langchain,langgraph}_adapter.py` | LangChain (`create_agent`) vs LangGraph (`StateGraph`) |
| 提示词 | 4 | `arena/prompts.py` | Zero-shot / Few-shot / CoT Prompt / Structured |
| 推理模式 | 4 | `arena/reasoning_graph.py` | ReAct / CoT+Tool / ToT / Reflexion（4 张独立图） |
| 上下文 | 4 | `arena/context_manager.py` + `arena/rag.py` | 滑动窗口 / 摘要 / 向量检索（TF-IDF）/ 混合 |
| Harness | 4 | `arena/harness.py` | 裸运行 / 验证 / 反思 / 自进化（HarnessRunner `astream_events` 拦截） |

### Agent 能力

每个 Agent 拥有独立工作空间，支持 11 个工具（`arena/tools.py`）：

| 类别 | 工具 |
|------|------|
| 基础 | `get_current_time` / `calculate`（AST 白名单） |
| 工作空间 | `write_file` / `append_file` / `create_file` / `read_file` / `list_files` / `file_tree` / `delete_file` |
| 代码执行 | `run_code`（**独立进程沙箱 + AST 静态校验 + 1-10s 超时强制 terminate/kill**） |
| 文本 | `summarize_text` |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js **16.2.10** + React 19.2.4 + TypeScript 5.9 + Tailwind v4 |
| 后端 | FastAPI + Python 3.10+ + SSE (sse-starlette) + Pydantic v2 |
| LLM | LangChain `ChatAnthropic` / `ChatOpenAI`，BYOK |
| 实时通信 | SSE（`EventSourceResponse`） |
| 数据 | 文件级 JSON（`data/provider_config.json` + `data/projects.json`），**无 SQL/ORM** |
| 前端状态 | 仅 React 内置 hooks |

> ⚠️ **Next.js 16 与训练数据差异较大**，写代码前务必读 `frontend/AGENTS.md` 与 `node_modules/next/dist/docs/`，已弃用 API 与旧文档可能不一致。

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+
- npm

### 后端启动

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# 或：pip install -e ".[dev]"（含 ruff/pytest/mypy）
cp .env.example .env  # 配置 API Key（可选，UI 也可配）
uvicorn app.main:app --reload --port 8000
```

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:3000 进入 Arena（根路径 `/` 会自动重定向）。

### 配置 Provider

首次使用需要在 Settings 页面配置 LLM Provider（BYOK）：
1. 填写 API Key
2. 配置 Base URL（默认 `https://api.stepfun.com/step_plan`，anthropic_messages 兼容）
3. 选择模型（默认 `step-3.7-flash`）
4. 点击「管理与测试」验证连接

API Key 保存在本地 `data/provider_config.json`，**仅本地保存，不会提交到 Git**。

支持的 API 格式：
- `anthropic_messages`（默认，Anthropic 兼容）
- `openai_chat`（OpenAI Chat 兼容，Settings 高级选项切换）

## 测试

```bash
# 后端测试 — 30 个测试文件 / 267+ 个 test_ 函数
PYTHONPATH=backend pytest tests/ -v

# 仅 lint
cd backend && ruff check app/ tests/

# 类型检查
cd backend && mypy app/ --ignore-missing-imports

# 前端类型检查 + 构建
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

> 测试根目录已迁移至仓库根 `tests/`（commit `8510cfa`），不再使用 `backend/tests/`。

## 开发约束

详见 [CLAUDE.md](./CLAUDE.md)。前端额外约束见 `frontend/AGENTS.md`（Next.js 16 警示）。

**当前开发进度报告**：[docs/PROGRESS.md](./docs/PROGRESS.md)。

## 最近改进

### 后端
- **任务模板库 + 自动判分器**（Phase 9）：`arena/templates.py` 8 个预置可判分模板 + `arena/judging.py` 确定性判分器（JSON / 关键词 / 代码语法 / 数字 / 拒答检测 / 正则，无 LLM 依赖）；`GET /api/arena/templates` + `POST /api/arena/judge`
- **安全加固**：self_evolve 的 prompt 注入脱敏生效（`_sanitize_prompt_additions`）；`run_code` 输出 32KB 截断（根治大输出误报超时）+ Queue 清理；`calculate` 拦截大指数幂 CPU DoS；断开清理加 5s 超时；向量片段 fence + 免责声明；LRU 淘汰保护运行中工作空间
- **WorkspaceManager 增加 TTL 与 LRU 上限**：默认 1h 空闲回收 + 最多 32 个工作空间（`commit 17c864d`）
- **LangGraph 适配器接入 HarnessRunner 主路径**：`astream_events` 真实拦截 verify/reflect/harness_edit（`commit 18785da`）
- **HarnessRunner.stream_events 真实验证重试循环**：max_retries 区分 bare/verify/reflect/self_evolve（`commit a054b26`）
- **run_code 改独立进程沙箱**：AST 静态校验 + terminate/kill 子进程（`commit 8e69763`）
- **提交 langchain-openai 依赖**：`api_format="openai_chat"` 实际可用（`commit 3c647d0`）
- **FastAPI 现代化**：`@app.on_event("startup")` 迁移到 `lifespan` 上下文管理器
- **API 安全**：连接测试错误响应仅返回异常类型，避免泄露内部 endpoint/堆栈
- **类型严谨**：`PipelineConfig.reasoning/context/harness/prompt_profile` 升级为 Literal；`mypy app/` 零错误

### 项目管理
- **Bug 修复**：`create_from_run` 之前用 `f"{label}_"` 模糊前缀匹配 workspace，同 label 多次跑会覆盖；改用 `workspace_names` 精确匹配
- **错误处理**：`_save` 写文件失败不再让 API 500，改为记录日志
- **ID 唯一**：`_generate_project_id` 添加微秒时间戳 + UUID 后缀，避免同毫秒并发创建冲突

### 前端
- **学习路径引导页 `/learn`**（Phase 8）：6 周学习路径，每步一键跳转 Arena 并预填模板/维度/子项
- **可判分任务模板**：Arena 底部模板区分「可判分」组（判分方式徽章），运行完成后自动判分并展示通过/未通过（列徽章 + 对比报告判分列）
- **URL 参数预填**：`/arena?template=...&q=...&dimension=...&selections=...`
- **TraceDiff 长文本展开**：>300 字符可「展开全文/收起」
- **Arena 对比报告增加「保存为项目」**：`ArenaClient` 跑完后输入项目名一键入库（`commit 1665376`）
- **workspace 真实名**：WorkspacePanel 优先取事件中的真实 workspace 名，禁止猜测前缀
- **可访问性**：aria-labels + toast 定时器清理

### 测试
- **判分器 22 用例 + 模板库 9 用例**（`tests/test_judging.py` + `tests/test_templates.py`）
- **ContextVar 取消路径回归**：CancelledError 下 finally 必须清空 pipeline 覆盖参数
- **前端契约**：模板/判分/学习路径/URL 预填 API 契约测试
- **WorkspaceManager TTL/LRU 回收用例**（`commit e398964`）
- **测试目录规范迁移至仓库根 tests/**（`commit 8510cfa`）

## 路线图

- [x] Phase 1: 双框架对比 + SSE 流式输出
- [x] Phase 2: 工具集扩充 + 工作空间 + 提示词维度 + 项目管理
- [x] Phase 3: 三栏 UI + 对比报告 + 真流式 thought_delta
- [x] Phase 4: 全维度启用（推理/上下文/Harness 引擎 + LangGraph 图）
- [x] Phase 5: Harness 引擎完善（Verify/Reflect/Self-Evolve + 真实验证循环）
- [x] Phase 8: 学习路径引导 UI（`/learn` 6 周计划，一键预填 Arena）
- [x] Phase 9: 任务模板库（8 个预置可判分模板 + 确定性判分器）
- [ ] Phase 6: AutoGen / CrewAI Adapter 实装（预留条目，Python 3.14 环境暂不可装）
- [ ] Phase 7: MCP Server / Client 集成
- [ ] Phase 10: Harness Lab（独立 YAML 编辑器 + Primitive 组合）

详见 [docs/PROGRESS.md](./docs/PROGRESS.md) §5。

## License

MIT