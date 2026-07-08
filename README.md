# AgentPrism

> One beam of light, refracted into the full spectrum of Agent possibilities.

**AgentPrism** 是一个 Agent 对比实验台（Arena）。用户输入一个问题，多条 Agent 管线受控并行运行，让你直观看到 **LangChain vs LangGraph**、提示词策略、推理模式、上下文策略、Harness 配置之间的差异。

MVP 聚焦 **LangChain + LangGraph** 双框架；AutoGen / CrewAI 通过适配器接口预留扩展。

就像一束白光穿过棱镜折射出光谱——一个问题，折射出 Agent 的万千可能。

## 为什么需要 AgentPrism

学 Agent 开发最大的痛点：**框架太多，不知道选哪个；模式太多，不知道差在哪。**

- LangChain、LangGraph、AutoGen、CrewAI……文档各看一遍，还是不会选
- ReAct、CoT、ToT、Reflexion……概念都懂，但跑起来到底有什么区别？
- Harness Engineering、Loop Engineering……2026 最前沿的概念，没有项目实践过

AgentPrism 的答案：**同一个问题，四条管线并行跑，差异一目了然。**

## 核心体验

```
┌─────────────────────────────────────────────────────────┐
│  AgentPrism Arena                                        │
│                                                          │
│  ┌───────────┐ ┌───────────┐                                │
│  │ LangChain  │ │ LangGraph  │   ← 框架维度（2 列）         │
│  │            │ │            │                                │
│  │ Thought    │ │ Thought    │                                │
│  │ Action     │ │ Action     │                                │
│  │ ...        │ │ ...        │                                │
│  │            │ │            │                                │
│  │ ✅ 12.3s   │ │ ✅ 9.1s    │                                │
│  │ 💰 2.1k tok│ │ 💰 1.8k tok│                                │
│  └───────────┘ └───────────┘                                │
│                                                          │
│  对比维度：[框架] [提示词] [推理模式] [上下文] [Harness]    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  输入你的问题...                            [发送] │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 对比维度

| 维度 | 对比内容 | 列数 | 学到什么 |
|------|---------|------|---------|
| **框架** | LangChain vs LangGraph（AutoGen/CrewAI 预留） | 2 | 链式编排 vs 图编排的差异 |
| **提示词** | Zero-shot / Few-shot / CoT Prompt / Structured | 4 | 提示工程对格式遵从与推理链的影响 |
| **推理模式** | ReAct vs CoT+Tool vs ToT vs Reflexion | 4 | 不同推理策略的准确率、速度、token 消耗 |
| **上下文策略** | 滑动窗口 vs 摘要压缩 vs 向量检索 vs 混合策略 | 4 | 长对话场景下各策略的保留/丢失信息 |
| **Harness** | 无验证 vs 验证 vs 反思 vs 自进化 | 4 | Harness Engineering 对结果质量的提升 |

## 与 InterviewOS / RepoPilot 的关系

| 项目 | 框架 | 场景 | 你学到的 |
|------|------|------|---------|
| InterviewOS | 自研 | 交互式 Agent（人驱动） | 手写状态机、多模态融合、回合制交互 |
| RepoPilot | 自研 | 知识型 Agent（知识驱动） | Multi-Agent 编排、Memory Architecture、推理引擎切换 |
| **AgentPrism** | **LangChain + LangGraph（可扩展）** | **实验型 Agent（对比驱动）** | **框架实战、提示词工程、跨维度对比方法论** |

三个项目覆盖 Agent 开发的完整知识图谱：自研能力 × 框架实战 × 前沿工程化。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.12+ / FastAPI |
| Agent 框架 | LangChain + LangGraph（`FrameworkAdapter` 可扩展） |
| 前端 | Next.js 15 / React 19 / TypeScript |
| LLM | OpenAI 兼容 API（BYOK） |
| 向量存储 | Chroma |
| 实时通信 | SSE（流式输出） |

## 前沿技术覆盖

- **Loop Engineering** — Loop Specification 五要素（Trigger → Goal → Verify → Stop Rule → Memory）
- **Harness Engineering** — 可组合的 Harness Primitive + 自进化 Harness
- **Self-Evolving Agent** — Weakness Mining → Harness Proposal → Proposal Validation
- **MCP（Model Context Protocol）** — Server + Client 完整实现
- **Agent 评估** — 过程纪律 + 结果质量 + 资源消耗三维评估

## License

MIT
