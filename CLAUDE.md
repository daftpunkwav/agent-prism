# AgentPrism 开发约束

> **Tradeoff:** 这些指南偏向 **审慎优先于速度**。对于琐碎任务请自行判断。

## 1. Language & Communication

* **Default Language:** 所有响应、解释和逻辑分析使用**中文**。
* **Code Documentation:** 代码注释和 docstring 使用**中文**。
* **Technical Precision:** 中文为主，但技术名词保留英文（如 "并发"、"Middleware"）。

## 2. 技术栈

- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4
- **后端**: FastAPI + Python 3.11+ + SSE (sse-starlette) + Pydantic v2
- **LLM**: LangChain + LangGraph + ChatAnthropic / ChatOpenAI（BYOK）
- **前端状态**: 仅 React useState/useReducer/useRef，不用 Zustand/Redux
- **后端数据**: 文件级 JSON（data/ 目录），不用数据库
- **目标 Python 版本**: `requires-python >=3.11`；CI 使用 3.14（与本地 venv 对齐，本地 3.11+ 亦可）

## 3. 目录规范

```
backend/app/
├── main.py                  # FastAPI 入口（lifespan、CORS、请求大小限制、日志）
├── config.py                # 配置加载（.env + JSON）
├── models.py                # Pydantic 模型
├── storage.py               # 原子写 JSON（tmp → bak → rename）
├── api/                     # FastAPI 路由
│   ├── __init__.py
│   ├── arena.py             # Arena API（meta、run/SSE、templates、judge、workspace、projects）
│   └── settings.py          # Provider 配置 API（GET/PUT /test）
├── arena/                   # Arena 核心逻辑
│   ├── router.py            # 维度路由（5 维度全启用）
│   ├── runner.py            # 并行运行池
│   ├── prompts.py           # Prompt 模板 + build_messages（4 profiles）
│   ├── llm.py               # LLM 客户端工厂（ChatAnthropic / ChatOpenAI）
│   ├── tools.py             # 统一 Tool 集（11 个工具 + 沙箱）
│   ├── tool_guard.py        # 工具相关性守卫（拦截跑题 tool_calls）
│   ├── message_sanitize.py  # 消息消毒 + 任务锚定
│   ├── workspace.py         # Agent 工作空间（contextvars.ContextVar 隔离）
│   ├── context_manager.py   # 上下文策略
│   ├── reasoning.py         # 推理模式 prompt 模板
│   ├── reasoning_graph.py   # 推理模式 LangGraph 图
│   ├── harness.py           # Harness 引擎（验证/反思/自进化）
│   ├── rag.py               # RAG 向量检索（TF-IDF）
│   ├── templates.py         # 任务模板库（8 个预置可判分模板）
│   ├── judging.py           # 确定性判分器（无 LLM）
│   ├── errors.py            # 对外错误脱敏（仅异常类型名）
│   ├── agent_state.py       # AgentState 共享 TypedDict 定义
│   ├── project.py           # 项目管理
│   ├── token_utils.py       # Token 统计
│   ├── stream_utils.py      # 流式解析工具
│   ├── types.py             # 共享 Literal 类型
│   └── __init__.py
├── adapters/                # 框架适配器
│   ├── base.py              # FrameworkAdapter Protocol + Registry
│   ├── common.py            # 共享函数
│   ├── langchain_adapter.py
│   └── langgraph_adapter.py

tests/                       # 单元测试（pytest，仓库根目录；29 文件 / 268 个 test_）

frontend/src/
├── app/                     # 页面（App Router）
│   ├── page.tsx             # 根页面（重定向 /arena）
│   ├── layout.tsx           # 根布局
│   ├── error.tsx            # 路由级错误边界
│   ├── global-error.tsx     # 全局错误边界
│   ├── arena/               # Arena 页面 + ArenaClient
│   │   ├── page.tsx
│   │   └── ArenaClient.tsx
│   ├── learn/page.tsx       # 学习路径（6 周引导）
│   ├── settings/page.tsx    # Provider 配置
│   └── projects/page.tsx    # 项目管理
├── components/              # UI 组件
│   ├── AppShell.tsx         # 导航栏（Arena / 学习路径 / 项目 / 设置）
│   ├── ThemeToggle.tsx      # 主题切换
│   ├── TraceView.tsx        # 轨迹渲染
│   ├── WorkspacePanel.tsx   # 工作空间（含文件编辑器）
│   ├── ExperimentPanel.tsx  # 实验参数
│   ├── TokenStatsPanel.tsx  # Token 统计
│   └── TraceDiff.tsx        # Trace 对比
├── lib/
│   └── api.ts               # 前端 API 层（15 个函数）

# 全局样式：frontend/src/app/globals.css

.github/workflows/          # CI
└── ci.yml                   # GitHub Actions（ruff + mypy + pytest + tsc + build）

.pre-commit-config.yaml      # pre-commit hooks（ruff + trailing-whitespace + check-yaml 等）
scripts/
├── dev-backend.ps1          # 后端开发启动脚本
└── dev-frontend.ps1         # 前端开发启动脚本
```

## 4. 命名规范

### Python
- 文件名: `snake_case.py`
- 类名: `PascalCase`
- 函数/变量: `snake_case`
- 常量: `UPPER_SNAKE_CASE`
- 所有注释和 docstring 使用**中文**

### TypeScript/React
- 文件名: `PascalCase.tsx`（组件）/ `camelCase.ts`（工具）
- 组件名: `PascalCase`
- 函数/变量: `camelCase`
- 类型/接口: `PascalCase`
- CSS 类名: `kebab-case`（自定义类）或 Tailwind 原子类

## 5. 代码约束

### 后端
- 所有新模块必须有对应 `tests/test_xxx.py`（仓库根目录）
- 运行测试: `PYTHONPATH=backend pytest tests/ -v`（仓库根目录）
- 运行 lint: `cd backend && ruff check app/`
- 运行类型检查: `cd backend && mypy app/ --ignore-missing-imports`
- Pydantic 模型放在 `models.py`（模板/判分相关模型可在对应模块内）
- Tool 定义在 `arena/tools.py`，纯函数提取为 `_safe_xxx` 便于测试
- SSE 事件统一用 `ArenaEvent` + `json.dumps(ensure_ascii=False)`
- 对外错误用 `sanitize_error_message`（仅异常类型名），不泄露堆栈/密钥
- 线程安全: Agent 工作空间通过 `contextvars.ContextVar` 隔离（异步栈感知，非 threading.local）
- JSON 持久化走 `storage.atomic_write_json`
- 优先用标准库，不引入新依赖

### 前端
- 组件使用 `"use client"`
- 状态管理只用 React 内置 hooks
- CSS 类定义在 `globals.css`，不在 JSX 写 style
- Markdown 渲染用 `react-markdown` + `remark-gfm`
- 所有文本使用**中文**

## 6. Git 工作流

- **功能分支**: `feat/xxx` 或 `fix/xxx`
- **每 Phase 一个 commit**，粒度细
- **commit message 格式**: `type(scope): 描述`
  - type: `feat` / `fix` / `refactor` / `test` / `chore` / `style` / `docs`
  - scope: `backend` / `frontend` / `arena` / `ui` / `security` / `ci`
- **大功能**: 新开分支开发 → 测试全绿 → fast-forward 合并到 main
- **pre-commit + CI**: pre-commit（ruff + trailing-whitespace + check-yaml）+ CI（ruff + mypy + pytest + tsc + build）自动校验

## 7. 安全约束

- `calculate` 工具: 白名单 AST 节点，仅允许数字 + 算术运算符；拦截大指数幂
- `run_code` 工具: 独立进程沙箱 + AST 静态校验 + 1–10s 超时 terminate/kill + 输出截断
- 路径规范化: 拒绝绝对路径、`..`、`./`
- Tool 调用通过 `contextvars.ContextVar` 隔离
- Provider API Key 脱敏返回；SSE 错误仅暴露异常类型名
- 请求体大小限制 10MB（防止超大请求）
- SSE 客户端断开: 捕获 `CancelledError` 优雅退出
- RAG / Harness: 检索片段 fence + prompt 注入脱敏

## 8. 适配器扩展（新增框架）

```python
from app.adapters.base import FrameworkAdapter, FrameworkAdapterRegistry

class AutoGenAdapter:
    framework_id = "autogen"
    display_name = "AutoGen"

    async def run(self, question: str, config: PipelineConfig):
        """流式运行并产出 ArenaEvent。"""
        # 实现你的逻辑
        ...

registry = FrameworkAdapterRegistry()
registry.register(AutoGenAdapter())
```

实现要点：
- 必须实现 `framework_id`（类属性）和 `display_name`（类属性）
- 必须实现 `async def run(question, config) -> AsyncIterator[ArenaEvent]`
- 调用 `registry.register()` 注册后自动从 reserved 移除，UI 立即可用
- `AdapterReservedError` 在访问 reserved 框架时自动抛出

## 9. 禁止事项

- 不删除用户数据（provider_config.json、projects.json）除非明确要求
- 不在生产代码中使用 `print()`，用 `logging`
- 不引入新的前端框架依赖
- 不修改已有的用户可见行为（除非是 bug 修复）
