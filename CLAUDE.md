# AgentPrism 开发约束

## 技术栈

- **前端**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **后端**: FastAPI + Python 3.10+ + SSE (sse-starlette) + Pydantic v2
- **LLM**: LangChain + LangGraph + ChatAnthropic（BYOK）
- **前端状态**: 仅 React useState/useReducer，不用 Zustand/Redux
- **后端数据**: 文件级 JSON（data/ 目录），不用数据库

## 目录规范

```
backend/app/
├── main.py              # FastAPI 入口
├── config.py            # 配置加载（.env + JSON）
├── models.py            # Pydantic 模型（所有请求/响应/事件）
├── api/                 # FastAPI 路由
│   ├── arena.py         # Arena 相关 API
│   └── settings.py      # Provider 配置 API
├── arena/               # Arena 核心逻辑
│   ├── router.py        # 维度路由
│   ├── runner.py        # 并行运行池
│   ├── prompts.py       # Prompt 模板 + build_messages
│   ├── llm.py           # LLM 客户端工厂
│   ├── tools.py         # 统一 Tool 集（所有 Agent 共用）
│   ├── workspace.py     # Agent 工作空间（内存文件系统）
│   ├── context_manager.py  # 上下文策略
│   ├── reasoning.py     # 推理模式引擎
│   ├── harness.py       # Harness 引擎
│   ├── project.py       # 项目管理
│   ├── token_utils.py   # Token 统计
│   └── stream_utils.py  # 流式解析工具
├── adapters/            # 框架适配器
│   ├── base.py          # FrameworkAdapter Protocol + Registry
│   ├── common.py        # 共享函数（build_metrics 等）
│   ├── langchain_adapter.py
│   └── langgraph_adapter.py
└── tests/               # 单元测试（pytest）

frontend/src/
├── app/
│   ├── layout.tsx       # 根布局
│   ├── page.tsx         # 入口（重定向 /arena）
│   ├── globals.css      # CSS 变量 + 组件样式
│   ├── arena/page.tsx   # Arena 主页面
│   ├── settings/page.tsx # Provider 配置
│   └── projects/page.tsx # 项目管理
├── components/
│   ├── AppShell.tsx     # 导航栏
│   ├── ThemeToggle.tsx  # 主题切换
│   ├── TraceView.tsx    # 轨迹渲染（打字机 + Markdown）
│   ├── WorkspacePanel.tsx # 工作空间文件浏览器
│   ├── ExperimentPanel.tsx # 实验参数面板
│   ├── TokenStatsPanel.tsx # Token 统计
│   └── ComparisonReport.tsx # 对比报告
└── lib/
    └── api.ts           # 前端 API 层
```

## 命名规范

### Python
- 文件名: `snake_case.py`
- 类名: `PascalCase`
- 函数/变量: `snake_case`
- 常量: `UPPER_SNAKE_CASE`
- 所有注释和文档字符串使用**中文**

### TypeScript/React
- 文件名: `PascalCase.tsx`（组件）/ `camelCase.ts`（工具）
- 组件名: `PascalCase`
- 函数/变量: `camelCase`
- 类型/接口: `PascalCase`
- CSS 类名: `kebab-case`（自定义类）或 Tailwind 原子类

## 代码约束

### 后端
- 所有新模块必须有对应 `tests/test_xxx.py` 单元测试
- 运行测试: `cd backend && pytest tests/ -v`
- Pydantic 模型放在 `models.py`，不要散落在各模块
- Tool 定义在 `tools.py`，用 `@tool` 装饰器
- SSE 事件统一用 `ArenaEvent` 模型，`json.dumps(ensure_ascii=False)`
- 线程安全: Agent 工作空间通过 `threading.local()` 隔离
- 不要引入新依赖，优先用标准库

### 前端
- 组件使用 `"use client"` 指令
- 状态管理只用 React 内置 hooks（useState/useReducer/useRef）
- 不用任何状态管理库
- 自定义 CSS 类定义在 `globals.css`，不在 JSX 中写 style
- Markdown 渲染用 `react-markdown` + `remark-gfm`
- 所有文本内容使用**中文**

## Git 工作流

- 功能分支: `feat/xxx` 或 `fix/xxx`
- 每 Phase 一个 commit，粒度要细
- commit message 格式: `type(scope): 描述`
  - type: `feat` / `fix` / `refactor` / `test` / `chore`
  - scope: `backend` / `frontend` / `arena` / `ui` 等

## 禁止事项

- 不删除用户数据（provider_config.json、projects.json）除非明确要求
- 不在生产代码中使用 `print()`，用 logging
- 不在 Tool 中引入文件系统/网络访问（run_code 除外，它有沙箱限制）
- 不引入新的前端框架依赖
- 不修改已有的用户可见行为（除非是 bug 修复）
