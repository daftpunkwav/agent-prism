# AgentPrism 开发约束

## 技术栈

- **前端**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **后端**: FastAPI + Python 3.10+ + SSE (sse-starlette) + Pydantic v2
- **LLM**: LangChain + LangGraph + ChatAnthropic（BYOK）
- **前端状态**: 仅 React useState/useReducer/useRef，不用 Zustand/Redux
- **后端数据**: 文件级 JSON（data/ 目录），不用数据库

## 目录规范

```
backend/app/
├── main.py              # FastAPI 入口
├── config.py            # 配置加载（.env + JSON）
├── models.py            # Pydantic 模型（所有请求/响应/事件）
├── api/                 # FastAPI 路由
│   ├── arena.py         # Arena 相关 API（run/workspace/projects）
│   └── settings.py      # Provider 配置 API
├── arena/               # Arena 核心逻辑
│   ├── router.py        # 维度路由（5 维度全启用）
│   ├── runner.py        # 并行运行池（asyncio.Queue 合并 SSE）
│   ├── prompts.py       # Prompt 模板 + build_messages（集成 reasoning/harness）
│   ├── llm.py           # LLM 客户端工厂（ChatAnthropic）
│   ├── tools.py         # 统一 Tool 集（11 个工具 + 沙箱）
│   ├── workspace.py     # Agent 工作空间（内存文件系统，线程安全）
│   ├── context_manager.py  # 上下文策略（sliding/summary/hybrid）
│   ├── reasoning.py     # 推理模式引擎（4 种模式 prompt 注入）
│   ├── harness.py       # Harness 引擎（4 级 prompt 注入）
│   ├── project.py       # 项目管理（JSON 持久化）
│   ├── token_utils.py   # Token 统计（实时累计 + 上下文占比）
│   └── stream_utils.py  # 流式解析工具（含 extended thinking）
├── adapters/            # 框架适配器
│   ├── base.py          # FrameworkAdapter Protocol + Registry
│   ├── common.py        # 共享函数（build_metrics, workspace 管理）
│   ├── langchain_adapter.py
│   └── langgraph_adapter.py
└── tests/               # 单元测试（pytest，51+ 用例）

frontend/src/
├── app/
│   ├── layout.tsx       # 根布局（AppShell + 主题初始化）
│   ├── page.tsx         # 入口（重定向 /arena）
│   ├── globals.css      # CSS 变量 + 组件样式 + 动画
│   ├── arena/page.tsx   # Arena 主页面（三栏布局 + 对比报告）
│   ├── settings/page.tsx # Provider 配置（BYOK）
│   └── projects/page.tsx # 项目管理
├── components/
│   ├── AppShell.tsx     # 导航栏（Arena/Projects/Settings）
│   ├── ThemeToggle.tsx  # 深色/浅色主题切换
│   ├── TraceView.tsx    # 轨迹渲染（rAF + ref + Markdown + 颜色编码）
│   ├── WorkspacePanel.tsx # 工作空间文件浏览器
│   ├── ExperimentPanel.tsx # 实验参数面板
│   ├── TokenStatsPanel.tsx # Token 统计面板
│   └── ComparisonReport.tsx # 对比报告（内联在 arena/page）
└── lib/
    └── api.ts           # 前端 API 层（SSE + REST）
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
- Tool 实现提取为纯函数（如 `_safe_calculate`），便于单元测试
- SSE 事件统一用 `ArenaEvent` 模型，`json.dumps(ensure_ascii=False)`
- 线程安全: Agent 工作空间通过 `threading.local()` 隔离
- 不要引入新依赖，优先用标准库
- **工具沙箱**: `calculate` 仅允许纯算术表达式；`run_code` 沙箱限制为基本内置函数

### 前端
- 组件使用 `"use client"` 指令
- 状态管理只用 React 内置 hooks（useState/useReducer/useRef）
- 不用任何状态管理库
- 自定义 CSS 类定义在 `globals.css`，不在 JSX 中写 style
- Markdown 渲染用 `react-markdown` + `remark-gfm`
- 所有文本内容使用**中文**
- **TraceView**: 打字机动画用 rAF + ref 驱动，避免 state 闭包陷阱
- **列颜色**: 每列独有 accent color（CSS 变量 chart-1~4），一致用于 border/tag/icon

## Git 工作流

- 功能分支: `feat/xxx` 或 `fix/xxx`
- 每 Phase 一个 commit，粒度要细
- commit message 格式: `type(scope): 描述`
  - type: `feat` / `fix` / `refactor` / `test` / `chore`
  - scope: `backend` / `frontend` / `arena` / `ui` 等

## 安全约束

- `calculate` 工具：白名单 AST 节点，仅允许数字 + 算术运算符
- `run_code` 工具：沙箱命名空间仅暴露安全内置函数，移除 `getattr`/`setattr`/`open`/`import`
- Tool 调用通过 `threading.local()` 关联当前 Agent 工作空间，互不干扰
- Provider API Key 脱敏返回，仅存在本地 `data/provider_config.json`

## 禁止事项

- 不删除用户数据（provider_config.json、projects.json）除非明确要求
- 不在生产代码中使用 `print()`，用 logging
- 不引入新的前端框架依赖
- 不修改已有的用户可见行为（除非是 bug 修复）
