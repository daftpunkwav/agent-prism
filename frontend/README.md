# AgentPrism Frontend

Next.js 16 App Router 前端：Arena 实验台、学习路径、项目管理、Provider 设置。

> ⚠️ **This is NOT the Next.js you know.** 写代码前务必读 [`AGENTS.md`](./AGENTS.md) 与 `node_modules/next/dist/docs/`。

## 技术栈

- Next.js **16.2.10** + React **19.2.4** + TypeScript 5.9
- Tailwind CSS v4
- 状态：仅 React 内置 hooks（无 Zustand/Redux）
- Markdown：`react-markdown` + `remark-gfm`

## 页面

| 路径 | 说明 |
|------|------|
| `/` | 重定向到 `/arena` |
| `/arena` | 主实验台（五维度对比 + SSE 流式 + 判分） |
| `/learn` | 6 周学习路径（一键预填 Arena） |
| `/projects` | 项目管理 |
| `/settings` | Provider BYOK 配置 |

## 本地开发

```bash
# 需先启动后端（默认 http://localhost:8000）
cd frontend
npm install
npm run dev
```

打开 http://localhost:3000。

也可使用仓库脚本：`scripts/dev-frontend.ps1`。

## 校验

```bash
npx tsc --noEmit
npm run build
```

## 目录要点

```
src/
├── app/           # App Router 页面 + error.tsx / global-error.tsx
├── components/    # TraceView / WorkspacePanel / ExperimentPanel 等
└── lib/api.ts     # 与后端契约（15 个 API 函数）
```

后端与整体说明见仓库根 [`README.md`](../README.md)；开发约束见 [`CLAUDE.md`](../CLAUDE.md)。
