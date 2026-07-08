# AgentPrism 开发约束

> **Tradeoff:** 这些指南偏向 **审慎优先于速度**。对于琐碎任务请自行判断。

## 1. Language & Communication

* **Default Language:** 所有响应、解释和逻辑分析使用**中文**。
* **Code Documentation:** 代码注释和 docstring 使用**中文**。
* **Technical Precision:** 中文为主，但技术名词保留英文（如 "并发"、"Middleware"）。

## 2. 技术栈

- **前端**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **后端**: FastAPI + Python 3.10+ + SSE (sse-starlette) + Pydantic v2
- **LLM**: LangChain + LangGraph + ChatAnthropic（BYOK）
- **前端状态**: 仅 React useState/useReducer/useRef，不用 Zustand/Redux
- **后端数据**: 文件级 JSON（data/ 目录），不用数据库

## 3. 目录规范

```
backend/app/
├── main.py                  # FastAPI 入口（CORS、请求大小限制、日志）
├── config.py                # 配置加载（.env + JSON）
├── models.py                # Pydantic 模型
├── api/                     # FastAPI 路由
│   ├── arena.py             # Arena API（run/workspace/projects）
│   └── settings.py          # Provider 配置 API
├── arena/                   # Arena 核心逻辑
│   ├── router.py            # 维度路由（5 维度全启用）
│   ├── runner.py            # 并行运行池
│   ├── prompts.py           # Prompt 模板 + build_messages
│   ├── llm.py               # LLM 客户端工厂
│   ├── tools.py             # 统一 Tool 集（11 个工具 + 沙箱）
│   ├── workspace.py         # Agent 工作空间
│   ├── context_manager.py   # 上下文策略
│   ├── reasoning.py         # 推理模式 prompt 模板
│   ├── reasoning_graph.py   # 推理模式 LangGraph 图
│   ├── harness.py           # Harness 引擎（验证/反思/自进化）
│   ├── rag.py               # RAG 向量检索（TF-IDF）
│   ├── agent_state.py       # AgentState 共享定义
│   ├── project.py           # 项目管理
│   ├── token_utils.py       # Token 统计
│   └── stream_utils.py      # 流式解析工具
├── adapters/                # 框架适配器
│   ├── base.py              # FrameworkAdapter Protocol + Registry
│   ├── common.py            # 共享函数
│   ├── langchain_adapter.py
│   └── langgraph_adapter.py
└── tests/                   # 单元测试（pytest，88 用例）

frontend/src/
├── app/                     # 页面
│   ├── arena/page.tsx       # Arena 主页面
│   ├── settings/page.tsx    # Provider 配置
│   └── projects/page.tsx    # 项目管理
├── components/              # UI 组件
│   ├── AppShell.tsx         # 导航栏
│   ├── ThemeToggle.tsx      # 主题切换
│   ├── TraceView.tsx        # 轨迹渲染
│   ├── WorkspacePanel.tsx   # 工作空间（含文件编辑器）
│   ├── ExperimentPanel.tsx  # 实验参数
│   ├── TokenStatsPanel.tsx  # Token 统计
│   └── TraceDiff.tsx        # Trace 对比
└── lib/
    └── api.ts               # 前端 API 层

.github/workflows/          # CI
└── ci.yml                   # GitHub Actions

.pre-commit-config.yaml      # pre-commit hooks
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
- 所有新模块必须有对应 `tests/test_xxx.py`
- 运行测试: `cd backend && pytest tests/ -v`
- 运行 lint: `cd backend && ruff check app/ tests/`
- Pydantic 模型放在 `models.py`
- Tool 定义在 `tools.py`，纯函数提取为 `_safe_xxx` 便于测试
- SSE 事件统一用 `ArenaEvent` + `json.dumps(ensure_ascii=False)`
- 线程安全: Agent 工作空间通过 `threading.local()` 隔离
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
- **pre-commit + CI**: ruff + tsc + pytest 自动校验

## 7. 安全约束

- `calculate` 工具: 白名单 AST 节点，仅允许数字 + 算术运算符
- `run_code` 工具: 沙箱命名空间仅暴露安全内置函数
- 路径规范化: 拒绝绝对路径、`..`、`./`
- Tool 调用通过 `threading.local()` 隔离
- Provider API Key 脱敏返回
- 请求体大小限制 10MB（防止超大请求）
- SSE 客户端断开: 捕获 `CancelledError` 优雅退出

## 8. 适配器扩展（新增框架）

```python
from app.adapters.base import FrameworkAdapter
from app.adapters.base import FrameworkAdapterRegistry

class AutoGenAdapter:
    framework_id = "autogen"
    display_name = "AutoGen"

    async def run(self, question: str, config: PipelineConfig):
        # 实现你的逻辑
        ...

registry = FrameworkAdapterRegistry()
registry.register(AutoGenAdapter())
```

## 9. 禁止事项

- 不删除用户数据（provider_config.json、projects.json）除非明确要求
- 不在生产代码中使用 `print()`，用 `logging`
- 不引入新的前端框架依赖
- 不修改已有的用户可见行为（除非是 bug 修复）