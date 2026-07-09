# AgentPrism

> 同一个问题，多条管线受控并行，差异可量化、可复现。

**AgentPrism** 是一个 Agent 对比实验台（Arena）。用户输入一个问题或任务，系统同时启动多条 Agent 管线并行运行，实时流式展示每个 Agent 的推理过程、工具调用、中间结果，最终汇总对比报告。

就像一束白光穿过棱镜折射出光谱——一个问题，折射出 Agent 的万千可能。

## 为什么需要 AgentPrism

学 Agent 开发最大的痛点：**框架太多，不知道选哪个；模式太多，不知道差在哪。**

- LangChain、LangGraph、AutoGen、CrewAI……文档各看一遍，还是不会选
- ReAct、CoT、ToT、Reflexion……概念都懂，但跑起来到底有什么区别？
- Harness Engineering、Loop Engineering……2026 最前沿的概念，没有项目实践过

AgentPrism 的答案：**同一个问题，四条管线并行跑，差异一目了然。**

## 核心功能

### Arena 实验台

- **五维度对比**：框架 / 提示词 / 推理模式 / 上下文策略 / Harness
- **实时流式输出**：打字机效果渲染 Agent 推理过程，支持 Markdown
- **工具调用展示**：文件操作折叠预览、代码执行代码块、参数格式化
- **对比报告**：耗时 / Token / 工具调用 / 步骤数硬指标对比表格
- **Agent 工作空间**：每个 Agent 独立文件系统，实时文件浏览器侧栏
- **项目管理**：从 Arena 运行结果创建项目，保存工作空间和对比结果

### 对比维度

| 维度 | 列数 | 说明 |
|------|------|------|
| 框架 | 2 | LangChain vs LangGraph |
| 提示词 | 4 | Zero-shot / Few-shot / CoT Prompt / Structured |
| 推理模式 | 4 | ReAct / CoT+Tool / ToT / Reflexion |
| 上下文 | 4 | 滑动窗口 / 摘要 / 向量 / 混合 |
| Harness | 4 | 裸运行 / 验证 / 反思 / 自进化 |

### Agent 能力

每个 Agent 拥有独立工作空间，支持：
- 文件操作：`write_file` / `create_file` / `read_file` / `list_files` / `delete_file`
- 代码执行：`run_code`（沙箱限制）
- 工具调用：`get_current_time` / `calculate`
- 文本摘要：`summarize_text`

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + Python 3.10+ + SSE |
| Agent 框架 | LangChain + LangGraph（`FrameworkAdapter` 可扩展） |
| 前端 | Next.js 15 / React 19 / TypeScript |
| LLM | OpenAI 兼容 API（BYOK） |
| 实时通信 | SSE（流式输出） |

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- npm

### 后端启动

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 配置 API Key
uvicorn app.main:app --reload --port 8000
```

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:3000 进入 Arena。

### 配置 Provider

首次使用需要在 Settings 页面配置 LLM Provider（BYOK）：
1. 填写 API Key
2. 配置 Base URL（如 StepFun / Anthropic 兼容接口）
3. 选择模型
4. 点击「管理与测试」验证连接

API Key 保存在本地 `data/provider_config.json`，不会提交到 Git。

## 测试

```bash
# 后端测试（51+ 用例）
cd backend && pytest tests/ -v

# 前端类型检查
cd frontend && npx tsc --noEmit
```

## 开发约束

详见 [CLAUDE.md](./CLAUDE.md)。

## 最近改进

### 后端
- **FastAPI 现代化**:`@app.on_event("startup")` 迁移到 `lifespan` 上下文管理器
- **适配器修复**:LangGraph 适配器用 `on_chain_end` 正确捕获最终 state,消除 list-of-1 闭包 hack;复用 `get_reasoning_description` 而非硬编码
- **沙箱安全**:`run_code` 工具 stdout 重定向改为独立 StringIO,消除并发请求间输出污染
- **API 安全**:连接测试错误响应仅返回异常类型,避免泄露内部 endpoint/堆栈
- **API 一致性**:Arena `/meta` 复用 RunnerPool 中的注册表;`is_mvp_ready` 失效检查替换为 `route()` 的 ValueError 透传
- **类型严谨**:`prompts.py` `build_messages` 参数类型升级为 `ReasoningMode` / `HarnessLevel` Literal
- **去重**:`harness.py` 提取 `_strip_json_fence` 工具函数替代 3 处硬编码 markdown fence
- **性能**:DimensionRouter 用 `lru_cache` 缓存 provider 配置,避免每列重复读 JSON

### 项目管理
- **Bug 修复**:`create_from_run` 之前用 `f"{label}_"` 模糊前缀匹配 workspace,同 label 多次跑会覆盖;改用 `workspace_names` 精确匹配
- **错误处理**:`_save` 写文件失败不再让 API 500,改为记录日志
- **ID 唯一**:`_generate_project_id` 添加微秒时间戳,避免同毫秒并发创建冲突

### 前端
- **API 一致性**:ExperimentPanel 温度调节改 `onPointerUp` 统一提交(替代 `onMouseUp/TouchEnd/KeyUp` 三件套,后者在长按方向键时会反复触发 PUT)
- **渲染优化**:TraceView 用 `useState` setter 替代 `useReducer` 作渲染触发器

## 路线图

- [x] Phase 1: 双框架对比 + SSE 流式输出
- [x] Phase 2: 工具集扩充 + 工作空间
- [x] Phase 3: 三栏 UI + 对比报告
- [x] Phase 4: 全维度启用
- [x] Phase 5: 项目管理
- [ ] Phase 6: AutoGen / CrewAI Adapter
- [ ] Phase 7: MCP 集成
- [ ] Phase 8: 学习路径引导

## License

MIT
