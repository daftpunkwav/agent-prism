# AgentPrism PRD — 产品需求文档

## 1. 产品概述

### 1.1 产品定义

AgentPrism 是一个 Agent 对比实验台（Arena）。用户输入一个问题或任务，系统同时启动多条 Agent 管线并行运行，实时流式展示每个 Agent 的推理过程、工具调用、中间结果，最终汇总对比报告。

核心隐喻：**棱镜（Prism）** —— 一束白光（用户问题）穿过棱镜，折射出光谱（多维度 Agent 实现）。

### 1.2 目标用户

| 用户类型 | 痛点 | AgentPrism 如何解决 |
|---------|------|-------------------|
| Agent 开发初学者 | 框架太多不知道选哪个 | 同一问题 LangChain / LangGraph 并跑，差异直观可见 |
| 求职者（Agent 方向） | 面试被问"为什么选这个框架"说不清 | 亲手跑过对比，有数据有体感 |
| 技术选型者 | 选框架靠感觉，没有量化依据 | 对比报告有硬指标（成功率/速度/token）+ 可复现实验 |
| Agent 研究者 | 缺少可控实验环境 | 多维度切换、参数可调、Trace 可回放 |

### 1.3 核心价值主张

> **同一个问题，多条管线受控并行，差异可量化、可复现。**

不教你怎么用某个框架，而是让你**看懂框架、提示词、推理、上下文、Harness 之间的本质差异**，从而做出有依据的选择。

**MVP 聚焦**：LangChain + LangGraph 双框架对比；AutoGen / CrewAI 通过适配器接口预留，后续插件式接入。

---

## 2. 核心功能

### 2.1 Arena 实验台

#### 2.1.1 多列并行运行

用户输入问题后，按当前对比维度启动 **2～4 条管线**并行运行（列数由维度决定，见 §2.1.2）。每条管线独立运行，每列实时流式展示：

- **Thought**：当前推理步骤
- **Action**：调用的工具及参数
- **Observation**：工具返回的结果
- **Status**：运行中 / 完成 / 失败 / 超时

运行结束后每个列底部显示：

| 指标 | 说明 |
|------|------|
| ✅/❌ | 是否成功完成 |
| 耗时 | 从开始到结束的总时间 |
| Token 消耗 | 输入 + 输出 token 总数 |
| 工具调用次数 | 共调用了多少次工具 |
| 步骤数 | 推理循环了多少轮 |

#### 2.1.2 对比维度

用户通过顶部 Tab 切换对比维度。同一问题在不同维度下展示不同切面。**对比某一维度时，其余维度固定为默认值（控制变量法）**。

| 维度 ID | 名称 | 列数 | MVP | 说明 |
|---------|------|------|-----|------|
| `framework` | 框架 | 2 | ✅ | LangChain vs LangGraph |
| `prompt` | 提示词策略 | 4 | ✅ | 同一编排，不同 Prompt _PROFILE |
| `reasoning` | 推理模式 | 4 | Phase 2 | ReAct / CoT+Tool / ToT / Reflexion |
| `context` | 上下文策略 | 4 | Phase 2 | 滑动窗口 / 摘要 / 向量 / 混合 |
| `harness` | Harness | 4 | Phase 2 | 裸运行 / 验证 / 反思 / 自进化 |

---

**维度一：框架对比**（2 列，MVP 核心）

| 列 | 框架 | 编排方式 | 核心特点 | 状态 |
|----|------|---------|---------|------|
| 1 | LangChain | AgentExecutor + Tools | 链式组合，ReAct 生态成熟 | MVP 实现 |
| 2 | LangGraph | StateGraph + Nodes | 图编排，显式状态与检查点 | MVP 实现 |

**预留扩展**（实现 `FrameworkAdapter` 接口后注册即可接入，无需改 Arena 核心）：

| 框架 | 编排方式 | 接入阶段 |
|------|---------|---------|
| AutoGen | GroupChat + Agents | v0.2 |
| CrewAI | Crew + Tasks + Agents | v0.2 |

非框架维度默认以 **LangGraph** 为底座（推理/上下文/Harness 引擎基于 LangGraph 节点组合），保证控制变量时可比。

---

**维度二：提示词策略对比**（4 列，MVP）

固定框架与推理模式，仅切换 Prompt 配置（`PromptProfile`）：

| 列 | Profile | System / User 特征 | 测试重点 |
|----|---------|---------------------|---------|
| 1 | `zero_shot` | 极简指令，无示例 | 模型裸能力 + 工具调用稳定性 |
| 2 | `few_shot` | 嵌入 2～3 组任务示例 | 格式模仿与少样本泛化 |
| 3 | `cot_prompt` | 显式「逐步思考」引导（Prompt 层 CoT） | 推理链是否更完整（对比推理模式维度的 CoT+Tool） |
| 4 | `structured` | JSON Schema / 结构化输出约束 | 格式遵从、可解析性、L1 验证通过率 |

Prompt 模板版本化管理（`prompt_version`），写入 Trace 元数据，支持复跑同一实验。

---

**维度三：推理模式对比**（4 列，Phase 2）

| 列 | 模式 | 流程 | 适用场景 |
|----|------|------|---------|
| 1 | ReAct | Thought→Action→Observation 循环 | 通用工具调用 |
| 2 | CoT+Tool | 先推理链再调工具 | 需要深度推理后再行动 |
| 3 | ToT | 多分支探索→评估→选最优 | 多解空间搜索 |
| 4 | Reflexion | 执行→评估→反思→重试 | 需要自我纠错的任务 |

---

**维度四：上下文策略对比**（4 列，Phase 2）

适用于**脚本化多轮任务**（任务模板驱动，非单次问答）：

| 列 | 策略 | 机制 | 优劣 |
|----|------|------|------|
| 1 | 滑动窗口 | 保留最近 N 条消息 | 简单但丢失早期信息 |
| 2 | 摘要压缩 | 超阈值时对旧消息做摘要 | 信息保留好但有摘要损失 |
| 3 | 向量检索 | 按 embedding 相似度检索历史 | 相关性强但缺少时序 |
| 4 | 混合策略 | 摘要 + 向量 + 滑动窗口 | 综合最优但复杂 |

---

**维度五：Harness 对比**（4 列，Phase 2）

| 列 | Harness 级别 | 特征 |
|----|-------------|------|
| 1 | 裸运行 | 无验证循环，LLM 输出即最终结果 |
| 2 | 验证循环 | 有 Verify 步骤，不通过则重试 |
| 3 | 反思循环 | Verify + Reflect，基于失败原因调整策略 |
| 4 | 自进化 | Verify + Reflect + Harness 自修改 |

---

#### 2.1.2.1 可比性契约（Comparability Contract）

所有维度对比均遵循以下约束，确保结论可辩护：

| 约束项 | 规则 |
|--------|------|
| 控制变量 | 仅当前维度字段变化，其余 `PipelineConfig` 字段为维度默认值 |
| 统一 Tool 集 | 所有管线共用 `ToolRegistry`（相同 schema、相同 mock/fixture） |
| 统一模型 | 默认同一 `model_id` + `temperature`；可在高级设置中覆盖并标注 |
| 可复现 | 记录 `model_id`、`temperature`、`prompt_version`、`seed`（若 provider 支持） |
| Trace 规范化 | 框架原始事件 → `CanonicalEvent` → SSE；回放与 diff 基于 Canonical 层 |

**框架维度的两种模式**（高级设置可选）：

| 模式 | 目的 | 行为 |
|------|------|------|
| 受控模式（默认） | 科学对比资源消耗与成功率 | 统一 ReAct 骨架 + 统一 Tool + 统一 Prompt 基线 |
| 原生模式（v0.2） | 展示各框架惯用写法 | 各 Adapter 使用推荐范式，仅统一任务与 Tool 集 |

#### 2.1.3 对比报告

所有管线运行完成后，生成结构化对比报告。**硬指标排名**与 **LLM 软分析**分离呈现：

```json
{
  "question": "分析 Python GIL 对多线程性能的影响",
  "dimension": "framework",
  "reproducibility": {
    "model_id": "gpt-4o",
    "temperature": 0.0,
    "prompt_version": "v1.0.0",
    "tool_registry_version": "v1.0.0"
  },
  "results": [
    {
      "label": "LangChain",
      "success": true,
      "duration_ms": 12300,
      "total_tokens": 2100,
      "tool_calls": 3,
      "steps": 5,
      "verify_level_passed": "L2"
    },
    {
      "label": "LangGraph",
      "success": true,
      "duration_ms": 9100,
      "total_tokens": 1800,
      "tool_calls": 3,
      "steps": 4,
      "verify_level_passed": "L3"
    }
  ],
  "hard_ranking": ["LangGraph", "LangChain"],
  "soft_analysis": "（LLM 生成，标注为仅供参考）..."
}
```

任务模板库中的题目优先使用**可自动判分**的检查项（代码可执行、JSON 可解析、关键词命中等）；开放题不生成硬排名，仅展示指标与软分析。

### 2.2 任务模板库

预置不同类型的任务模板，覆盖 Agent 的典型场景：

| 模板 | 描述 | 测试重点 |
|------|------|---------|
| 信息检索 | "对比 React 和 Vue 的性能差异" | 工具调用准确性 |
| 代码生成 | "写一个并发爬虫并解释原理" | 代码正确性 + 推理深度 |
| 多步推理 | "分析这个API的设计缺陷并提出改进" | 推理链完整性 |
| 长上下文 | "总结这篇论文并指出三个关键贡献" | 上下文保持能力 |
| 工具组合 | "查询北京天气+推荐穿搭+生成购物清单" | 多工具编排能力 |

用户也可自定义任务。

### 2.3 Trace 回放

每次 Arena 运行生成完整 Trace，支持：

- 按步骤回放每个 Agent 的推理过程
- 对比同一步骤不同 Agent 的决策差异
- 导出 Trace 为 JSON 供离线分析

### 2.4 Harness Lab

独立的 Harness 实验模块，用户可以：

- 可视化组装 Harness Primitive（Prompt 模板 + Tool 集 + Memory 配置 + 控制流）
- 保存 Harness 配置为 YAML
- 在 Arena 中选择自定义 Harness 运行
- 启用 Self-Evolving 模式：Agent 运行后自动分析 Trace → 提出 Harness 修改 → 验证 → 应用

### 2.5 学习路径

面向初学者的引导式学习：

| 阶段 | 内容 | 对应功能 |
|------|------|---------|
| 第1周 | 框架入门 | 跑框架对比（LangChain vs LangGraph） |
| 第2周 | 提示词工程 | 跑提示词策略对比，观察格式与推理链差异 |
| 第3周 | 推理模式 | 跑推理模式对比，理解 Thought 差异 |
| 第4周 | 上下文工程 | 跑多轮任务 + 上下文策略对比 |
| 第5周 | Harness 工程 | Harness 对比 + Harness Lab |
| 第6周 | 综合实战 | 自定义任务 + 参数复现，独立完成实验报告 |

---

## 3. 系统架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                    │
│  Arena UI │ Harness Lab │ Trace Viewer │ Learning Path       │
└───────────────────────────┬─────────────────────────────────┘
                            │ SSE / REST
┌───────────────────────────┴─────────────────────────────────┐
│                     API Gateway (FastAPI)                     │
│  /arena/run │ /arena/trace │ /harness/ │ /tasks │ /learning  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    Arena Engine (核心)                        │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Dimension   │  │ Runner      │  │ Comparator           │ │
│  │ Router      │  │ Pool        │  │                      │ │
│  │             │  │ (2~4并行)   │  │ 硬指标汇总           │ │
│  │ 框架/提示词/│  │             │  │ 排名 + 软分析        │ │
│  │ 推理/上下文/│  │ via Adapter │  │ 报告输出             │ │
│  │ Harness    │  │ Registry    │  │                      │ │
│  └─────────────┘  └──────┬──────┘  └──────────────────────┘ │
│                          │                                   │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │           Framework Adapter Registry                   │  │
│  │  LangChainAdapter │ LangGraphAdapter │ (AutoGen stub) │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ ┌─────────┐ │
│  │ Prompt      │  │ Reasoning   │  │ Context  │ │ Harness │ │
│  │ Engine      │  │ Engine      │  │ Engine   │ │ Engine  │ │
│  │ 4 profiles  │  │ ReAct/CoT/  │  │ Sliding/ │ │ Bare/   │ │
│  │             │  │ ToT/Reflect │  │ Summary/ │ │ Verify/ │ │
│  │             │  │             │  │ Vector/  │ │ ...     │ │
│  │             │  │             │  │ Hybrid   │ │         │ │
│  └─────────────┘  └─────────────┘  └──────────┘ └─────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Tool Registry（统一 schema）→ Canonical Trace Emitter    │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    Infrastructure                            │
│  LLM Router (LiteLLM) │ Chroma │ Trace Store (SQLite) │ MCP │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Arena Engine 详细设计

#### 3.2.1 Framework Adapter（可扩展框架层）

新增框架只需实现 `FrameworkAdapter` 并注册，Arena 核心无需修改。

```python
class FrameworkAdapter(Protocol):
    """框架适配器接口 — LangChain / LangGraph MVP 实现；AutoGen / CrewAI 后续接入"""

    @property
    def framework_id(self) -> str: ...

    @property
    def display_name(self) -> str: ...

    async def astream(
        self,
        question: str,
        config: PipelineConfig,
        tools: ToolRegistry,
        emitter: CanonicalTraceEmitter,
    ) -> AsyncIterator[None]:
        """流式运行并将 CanonicalEvent 写入 emitter"""
        ...


class FrameworkAdapterRegistry:
    _adapters: dict[str, FrameworkAdapter]

    def register(self, adapter: FrameworkAdapter) -> None: ...

    def get(self, framework_id: str) -> FrameworkAdapter: ...

    def list_available(self) -> list[str]:
        """MVP: ["langchain", "langgraph"]"""

    def list_reserved(self) -> list[str]:
        """预留: ["autogen", "crewai"] — 注册前 UI 显示为「即将支持」"""
```

**MVP 实现**：`LangChainAdapter`、`LangGraphAdapter`  
**预留 Stub**：`AutoGenAdapter`、`CrewAIAdapter`（抛出 `NotImplementedError` 或返回占位说明，保证 Registry 接口与测试先行）

#### 3.2.2 Dimension Router

根据用户选择的对比维度，生成对应数量的 `PipelineConfig` 列表：

```python
DEFAULT_BASE = dict(
    framework="langgraph",
    reasoning="react",
    context="sliding",
    harness="bare",
    prompt_profile="zero_shot",
    model_id="gpt-4o",
    temperature=0.0,
)

class DimensionRouter:
    def route(self, question: str, dimension: str) -> list[PipelineConfig]:
        if dimension == "framework":
            return [
                PipelineConfig(**DEFAULT_BASE, framework="langchain", label="LangChain"),
                PipelineConfig(**DEFAULT_BASE, framework="langgraph", label="LangGraph"),
            ]
        elif dimension == "prompt":
            return [
                PipelineConfig(**DEFAULT_BASE, prompt_profile="zero_shot", label="Zero-shot"),
                PipelineConfig(**DEFAULT_BASE, prompt_profile="few_shot", label="Few-shot"),
                PipelineConfig(**DEFAULT_BASE, prompt_profile="cot_prompt", label="CoT Prompt"),
                PipelineConfig(**DEFAULT_BASE, prompt_profile="structured", label="Structured"),
            ]
        elif dimension == "reasoning":
            return [
                PipelineConfig(**DEFAULT_BASE, reasoning="react", label="ReAct"),
                PipelineConfig(**DEFAULT_BASE, reasoning="cot_tool", label="CoT+Tool"),
                PipelineConfig(**DEFAULT_BASE, reasoning="tot", label="ToT"),
                PipelineConfig(**DEFAULT_BASE, reasoning="reflexion", label="Reflexion"),
            ]
        elif dimension == "context":
            return [
                PipelineConfig(**DEFAULT_BASE, context="sliding", label="滑动窗口"),
                PipelineConfig(**DEFAULT_BASE, context="summary", label="摘要压缩"),
                PipelineConfig(**DEFAULT_BASE, context="vector", label="向量检索"),
                PipelineConfig(**DEFAULT_BASE, context="hybrid", label="混合策略"),
            ]
        elif dimension == "harness":
            return [
                PipelineConfig(**DEFAULT_BASE, harness="bare", label="裸运行"),
                PipelineConfig(**DEFAULT_BASE, harness="verify", label="验证循环"),
                PipelineConfig(**DEFAULT_BASE, harness="reflect", label="反思循环"),
                PipelineConfig(**DEFAULT_BASE, harness="self_evolve", label="自进化"),
            ]
```

**设计原则**：对比某个维度时，其他维度保持一致（控制变量法）。只有被对比的维度变化，其余字段使用 `DEFAULT_BASE`。

#### 3.2.3 Runner Pool

2～4 条管线并行运行，每条管线通过 Adapter Registry 调度：

```python
class RunnerPool:
    def __init__(self, adapters: FrameworkAdapterRegistry):
        self._adapters = adapters

    async def run_parallel(self, configs: list[PipelineConfig], question: str) -> list[RunResult]:
        tasks = [self._run_single(config, question) for config in configs]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return results

    async def _run_single(self, config: PipelineConfig, question: str) -> RunResult:
        adapter = self._adapters.get(config.framework)
        pipeline = PipelineFactory.create(config, adapter)  # 注入 Prompt/Reasoning/Context/Harness 引擎
        trace = []
        async for event in pipeline.astream(question):
            trace.append(event)
            yield SSEEvent(config.label, event)
        return RunResult(config=config, trace=trace)
```

#### 3.2.4 引擎设计

**Prompt Engine** — 四种提示词 Profile（MVP）：

| Profile | System Prompt 要点 | User Prompt 要点 |
|---------|-------------------|------------------|
| `zero_shot` | 角色 + 任务说明 + 工具说明 | 直接用户问题 |
| `few_shot` | 同上 | 前置 2～3 组 `{question, ideal_trace}` 示例 + 当前问题 |
| `cot_prompt` | 要求「先逐步推理再给最终行动」 | 用户问题 + `Let's think step by step` |
| `structured` | 规定输出 JSON Schema + 字段含义 | 用户问题 + schema 片段 |

模板存放于 `prompts/{profile}/v{version}.yaml`，支持版本回滚与 A/B 对比。

**Reasoning Engine** — 四种推理模式（Phase 2）：

| 模式 | 实现 | LangGraph 编排 |
|------|------|---------------|
| ReAct | Thought→Action→Observation 循环 | `agent_node → tool_node → agent_node → ...` |
| CoT+Tool | 先 CoT 推理链，再一次性调用工具 | `think_node → act_node → observe_node` |
| ToT | 生成 N 个候选→评估→选 top-K→继续 | `generate_node → evaluate_node → select_node → (循环)` |
| Reflexion | 执行→评估→反思→重试 | `execute_node → evaluate_node → reflect_node → (循环)` |

**Context Engine** — 四种上下文策略（Phase 2）：

| 策略 | 实现 |
|------|------|
| 滑动窗口 | 保留最近 N 条消息，丢弃更早的 |
| 摘要压缩 | 超过 token 阈值时，对旧消息调用 LLM 生成摘要，替换原始消息 |
| 向量检索 | 每条消息 embedding 存入 Chroma，按当前问题检索 top-K 相关历史 |
| 混合策略 | 最近 N 条 + 向量检索 top-K + 旧消息摘要，三者合并去重 |

**Harness Engine** — 四级 Harness（Phase 2）：

| 级别 | 实现 |
|------|------|
| Bare Run | LLM 输出直接返回，无验证 |
| Verify Loop | LLM 输出 → Verifier 检查 → 不通过则重试（最多 3 次） |
| Reflect Loop | Verify 不通过 → Reflector 分析原因 → 生成新策略 → 重试 |
| Self-Evolve | Reflect 后还修改自身 Harness 配置（Prompt / Tool 选择 / 控制流参数）→ 验证修改有效 → 应用 |

### 3.3 数据模型

```python
class PipelineConfig(BaseModel):
  framework: str           # langchain | langgraph | (autogen | crewai)
  reasoning: str           # react | cot_tool | tot | reflexion
  context: str             # sliding | summary | vector | hybrid
  harness: str             # bare | verify | reflect | self_evolve
  prompt_profile: str      # zero_shot | few_shot | cot_prompt | structured
  model_id: str
  temperature: float
  prompt_version: str
  label: str               # UI 列标签

class Run(Base):
    id: str
    question: str
    dimension: str           # framework | prompt | reasoning | context | harness
    column_count: int        # 2 或 4
    reproducibility: dict    # model_id, temperature, prompt_version, seed
    created_at: datetime
    user_id: str

class PipelineRun(Base):
    id: str                      # 管线运行 ID
    run_id: str                  # 所属 Arena 运行
    label: str                   # 列标签（如 "LangChain"）
    pipeline_config: dict        # PipelineConfig JSON
    status: str                  # running / completed / failed / timeout
    duration_ms: int             # 耗时
    total_tokens: int            # token 消耗
    tool_calls: int              # 工具调用次数
    steps: int                   # 推理步数
    answer: str                  # 最终答案
    trace: list[dict]            # Canonical Trace（含 raw 原始事件可选）

class ComparisonReport(Base):
    id: str                      # 报告 ID
    run_id: str                  # 所属 Arena 运行
    dimension: str               # 对比维度
    hard_ranking: list[str]           # 硬指标排名
    metrics: dict                      # 各管线硬指标明细
    soft_analysis: str                 # LLM 软分析（仅供参考）

class HarnessConfig(Base):
    id: str                      # Harness 配置 ID
    name: str                    # 配置名称
    user_id: str                 # 创建者
    primitives: dict             # Harness Primitive 组装配置
    yaml: str                    # YAML 格式配置
    created_at: datetime
    updated_at: datetime
```

### 3.4 SSE 事件协议

Arena 运行时，后端通过 SSE 向前端推送事件：

```typescript
type ArenaEvent =
  | { type: "thought";      pipeline: string; content: string; step: number }
  | { type: "action";       pipeline: string; tool: string; args: dict; step: number }
  | { type: "observation";  pipeline: string; result: string; step: number }
  | { type: "verify";       pipeline: string; passed: boolean; reason: string }
  | { type: "reflect";      pipeline: string; insight: string }
  | { type: "harness_edit"; pipeline: string; change: string; before: string; after: string }
  | { type: "complete";     pipeline: string; metrics: PipelineMetrics }
  | { type: "error";        pipeline: string; message: string }
```

---

## 4. 前沿技术设计

### 4.1 Loop Engineering

参考 arXiv:2607.00038，将 Loop Specification 作为一等公民：

```python
class LoopSpec:
    trigger: Trigger           # 什么启动循环（用户输入 / 定时 / 事件）
    goal: GoalSpec             # 目标定义（成功条件 / 约束）
    verify: VerifySpec         # 验证步骤（5级验证梯）
    stop_rule: StopRule        # 终止规则（最大步数 / 超时 / 成功 / 确定性失败）
    memory: MemorySpec         # 循环内记忆（跨迭代持久化 / 迭代内局部）
```

**五级验证梯**：

| 级别 | 名称 | 描述 | 示例 |
|------|------|------|------|
| L1 | 格式验证 | 输出格式正确 | JSON 可解析 |
| L2 | 约束验证 | 满足硬约束 | 代码可执行、无语法错误 |
| L3 | 语义验证 | LLM 判断结果质量 | "答案是否准确回答了问题" |
| L4 | 执行验证 | 实际运行验证 | 代码跑通 + 测试通过 |
| L5 | 基线验证 | 对比已知基线 | 准确率 > 阈值 |

不同 Harness 级别对应不同验证梯深度：

- Bare Run → 无验证
- Verify Loop → L1-L3
- Reflect Loop → L1-L4
- Self-Evolve → L1-L5

### 4.2 Harness Engineering

参考 HarnessX (arXiv:2606.14249) 和 Self-Harness (arXiv:2606.09498)：

**Harness Primitive** 是最小可组合单元：

```python
class HarnessPrimitive:
    kind: str          # "prompt" | "tool" | "memory" | "control_flow" | "verifier"
    name: str          # 原语名称
    config: dict       # 原语配置

# 示例
sliding_window = HarnessPrimitive(kind="memory", name="sliding_window", config={"max_messages": 20})
react_flow = HarnessPrimitive(kind="control_flow", name="react_loop", config={"max_steps": 10})
format_check = HarnessPrimitive(kind="verifier", name="json_format", config={})
```

**组合规则**：通过 substitution algebra 组装原语：

```python
class Harness:
    primitives: list[HarnessPrimitive]
    
    def compose(self, other: "Harness") -> "Harness":
        return Harness(primitives=self.primitives + other.primitives)
```

**Self-Evolving Harness** 三阶段循环：

```
┌─────────────────────────────────────────────┐
│                                              │
│  1. Weakness Mining                          │
│     分析 Trace → 识别失败模式                │
│     输出：List[Weakness]                     │
│                                              │
│  2. Harness Proposal                         │
│     针对每个 Weakness → 生成 Harness 修改提案│
│     输出：List[HarnessEdit]                  │
│                                              │
│  3. Proposal Validation                      │
│     应用修改 → 回归测试 → 仅接受有改进的修改 │
│     输出：Accepted[HarnessEdit]              │
│                                              │
└─────────────────────────────────────────────┘
         │
         ▼
    更新 Harness，进入下一轮运行
```

### 4.3 MCP 集成

```python
# MCP Server — AgentPrism 暴露的工具
@mcptool
async def arena_run(question: str, dimension: str) -> str:
    """在 AgentPrism Arena 中运行对比实验"""

@mcptool
async def arena_report(run_id: str) -> str:
    """获取 Arena 对比报告"""

# MCP Client — AgentPrism 调用外部 MCP 服务
class MCPToolBridge:
    """将 MCP Server 暴露的工具桥接为 LangChain Tool"""
    def discover_tools(self, mcp_server_url: str) -> list[BaseTool]:
        ...
```

---

## 5. 前端设计

### 5.1 Arena 页面

- 顶部：维度切换 Tab（**框架** / **提示词** / 推理模式 / 上下文策略 / Harness）
- 中部：**2 或 4 列**自适应并排（框架维度 2 列，其余默认 4 列），每列流式输出
- 侧栏（可折叠）：实验参数（model、temperature、prompt_version）+ **跑前 token 预估**
- 底部：输入框 + 任务模板快捷选择 + 发送按钮
- 运行结束后：对比报告折叠面板（硬指标表 + 软分析分开展示）

### 5.2 每列内部结构

```
┌────────────────────┐
│ 🏷️ LangGraph       │  ← 标签
│ ─────────────────  │
│ 🔵 Step 1          │
│ Thought: 需要先搜索 │  ← 当前推理步骤
│ ...                 │
│ 🟢 Step 2          │
│ Action: web_search  │  ← 工具调用
│ Args: {"query":...} │
│ 🟡 Step 3          │
│ Observation: ...    │  ← 工具返回
│ ─────────────────  │
│ ✅ 完成 | 9.1s      │  ← 运行指标
│ 💰 1.8k tokens      │
│ 🔧 3 tool calls     │
│ 📊 L3 验证通过      │
└────────────────────┘
```

### 5.3 对比报告面板

运行完成后弹出，包含：

- **硬指标表格**：各列耗时 / token / 步数 / 工具调用 / 验证级别并排对比
- **硬排名**：仅在有自动判分或明确成功条件时展示
- **雷达图**（Phase 3）：效率 / 成本 / 格式遵从 / 任务成功率
- **LLM 软分析**：自动生成对比解读，标注「仅供参考」
- **Trace 对比**：基于 Canonical 层的关键步骤决策差异高亮

### 5.4 维度 Tab 交互规范

#### 5.4.1 Tab 结构与信息层级

每个维度 Tab 由 **主标签 + 副说明** 组成，避免用户仅凭名称猜测差异：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [框架]  [提示词 ▾]  [推理模式]  [上下文]  [Harness]                      │
│          改 Prompt，编排不变                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

| 元素 | 规范 |
|------|------|
| 主标签 | 维度名称（框架 / 提示词 / 推理模式 / 上下文策略 / Harness） |
| 副说明 | 一行灰字，说明「本维度变什么、什么不变」；选中 Tab 时始终可见 |
| 列数徽章 | 框架 Tab 显示 `2列`，其余显示 `4列` |
| 即将支持 | AutoGen / CrewAI 在框架维度侧栏显示为禁用项 + Tooltip「Adapter 接入中」 |

各维度副说明文案（固定）：

| 维度 | 副说明 |
|------|--------|
| 框架 | 编排实现不同，Prompt / 推理 / 上下文 / Harness 保持一致 |
| 提示词 | 仅切换 Prompt 模板，LangGraph + ReAct 编排不变 |
| 推理模式 | 仅切换推理图节点，Prompt 基线保持一致 |
| 上下文策略 | 仅切换 Memory 策略，需使用多轮任务模板 |
| Harness | 仅切换验证 / 反思循环，其余配置保持一致 |

#### 5.4.2 「CoT Prompt」vs「CoT+Tool」消歧设计

二者名称相近但位于不同维度，必须在 UI 层明确区分：

| 对比项 | 提示词 · CoT Prompt | 推理模式 · CoT+Tool |
|--------|---------------------|---------------------|
| 维度 Tab | 提示词 | 推理模式 |
| 变化层 | System / User 文案 | LangGraph 节点编排 |
| 编排 | ReAct 循环不变 | `think_node → act_node → observe_node` |
| 典型 Trace | Thought 更冗长，仍逐步 Action | 先出现完整推理链，再集中 Tool 调用 |
| 适用问题 | 「加一句 step-by-step 有没有用？」 | 「先想后做 vs 边想边做，哪个更稳？」 |

**交互规范**：

1. **列头标签**：提示词维度第三列显示 `CoT Prompt`（带 `Prompt` 后缀）；推理维度第二列显示 `CoT+Tool`（带 `+Tool` 后缀），禁止两者使用相同文案。
2. **悬停 Tooltip**（列头 `?` 图标）：
   - CoT Prompt：`在 Prompt 中引导逐步思考，ReAct 编排不变`
   - CoT+Tool：`先完整推理，再统一调用工具，编排层变化`
3. **首次进入提示词维度**：顶部展示可关闭的 Info Banner：
   > 提示词维度的「CoT Prompt」只改文案；若要看编排层「先推理后行动」，请切换到 **推理模式 → CoT+Tool**。
4. **交叉跳转**：Banner 与 Tooltip 内「推理模式 → CoT+Tool」可点击，切换 Tab 并高亮目标列。
5. **Trace 视觉区分**：
   - CoT Prompt 列：Thought 气泡使用 **蓝色** 边框（Prompt 层输出）
   - CoT+Tool 列：在首个 Action 前增加 **「推理链完成」** 分隔线（编排层阶段切换）
6. **对比报告脚注**：若用户连续跑过 `prompt` 与 `reasoning` 两个维度，报告底部追加一行：
   > 本次实验同时覆盖 Prompt 层与编排层 CoT，解读时请区分二者。

#### 5.4.3 侧栏实验参数与跑前确认

```
┌─ 实验参数 ─────────────────┐
│ Model:      [gpt-4o    ▾]  │
│ Temperature:[0.0       ]  │
│ Prompt ver: [v1.0.0    ▾]  │  ← 仅提示词维度可编辑
│ ─────────────────────────  │
│ 预估消耗: ~8.4k tokens     │
│ (2列 × ~4.2k)              │
│ [取消]  [确认运行]         │
└────────────────────────────┘
```

- 点击「发送」后先弹出确认（含预估 token × 列数），用户确认后才开始并行运行。
- 提示词维度下侧栏展开 **Prompt 预览**（只读）：展示当前选中 Profile 的 System Prompt 摘要，支持展开全文。

---

## 6. 非功能性需求

| 需求 | 指标 |
|------|------|
| 并行运行延迟 | N 条管线并行，总耗时 ≈ 最慢单管线（非 N 倍） |
| SSE 流式延迟 | 每个事件 < 200ms 到达前端 |
| 单次运行超时 | 默认 120s，可配置 |
| Trace 存储 | SQLite，单次运行约 50-200KB |
| 并发用户 | 支持多用户同时运行不同 Arena |
| 跑前预估 | 展示预估 token × 列数，支持用户确认后执行 |

---

## 7. MVP 范围

### Phase 1：Arena 核心 + 双框架（2 周）

- [ ] `FrameworkAdapter` 接口 + `FrameworkAdapterRegistry`
- [ ] `LangChainAdapter` + `LangGraphAdapter` 实现
- [ ] AutoGen / CrewAI Stub 注册（UI 显示「即将支持」）
- [ ] `ToolRegistry` 统一 Tool schema
- [ ] `DimensionRouter` + `RunnerPool`
- [ ] 框架对比维度（2 列）
- [ ] SSE 流式输出 + Canonical Trace
- [ ] 前端 2/4 列自适应 UI
- [ ] 基础硬指标（耗时 / token / 步数 / 工具调用）

### Phase 2：提示词维度 + 任务模板（1.5 周）

- [ ] `PromptEngine` 四种 Profile + YAML 版本管理
- [ ] 提示词对比维度（4 列）
- [ ] 任务模板库 + 自动判分（代码 / JSON / 关键词）
- [ ] 跑前 token 预估与确认
- [ ] 实验可复现元数据写入 Run

### Phase 3：推理 + 上下文 + Harness 引擎（2.5 周）

- [ ] Reasoning Engine：ReAct / CoT+Tool / ToT / Reflexion
- [ ] Context Engine：四种策略 + 多轮脚本任务
- [ ] Harness Engine：Bare / Verify（MVP 先 2 级，Reflect / Self-Evolve 后补）

### Phase 4：对比报告 + Trace（1 周）

- [ ] 硬指标报告 + 软分析分离
- [ ] Trace 存储与回放
- [ ] 雷达图可视化

### Phase 5：框架扩展 + Harness Lab（后续）

- [ ] AutoGen + CrewAI Adapter 实装
- [ ] 框架「原生模式」对比
- [ ] Harness Primitive 组合 + YAML 导入导出
- [ ] Self-Evolving Harness（研究向，非 MVP 阻塞项）

### Phase 6：MCP + 学习路径（后续）

- [ ] MCP Server / Client
- [ ] 学习路径引导 UI

---

## 8. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| MVP 框架范围 | LangChain + LangGraph | 同属 Lang 生态，适配成本可控；对比价值高（链式 vs 图编排） |
| 框架扩展方式 | `FrameworkAdapter` + Registry | 新框架插件式接入，核心引擎零改动 |
| 非框架维度底座 | LangGraph | StateGraph 适合统一推理/上下文/Harness 节点组合 |
| 提示词管理 | YAML 版本化 `PromptProfile` | 与 Harness Primitive 解耦，便于 A/B 与复现 |
| 推理模式引擎 | 自研，基于 LangGraph 节点 | 统一接口，跨 Profile 可比 |
| 上下文引擎 | 自研，替换 LangChain Memory | 精确控制对比变量 |
| LLM 调用 | LiteLLM 统一封装 | BYOK + 多模型路由 + 降级链 |
| 向量存储 | Chroma（本地） | 零配置，适合单机开发 |
| Trace 存储 | SQLite + Canonical 层 | 轻量；框架差异在 Adapter 内消化 |
| 前端 | Next.js 15 + SSE | 与 InterviewOS/RepoPilot 技术栈一致 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| LangChain / LangGraph API 变化 | 双 Adapter 维护成本 | `FrameworkAdapter` 隔离；集成测试覆盖主路径 |
| 后续框架（AutoGen/CrewAI）范式差异大 | 「受控模式」对比失真 | 预留原生模式；文档明确两种模式适用场景 |
| 多管线并行 LLM 费用高 | 用户体验差 | 跑前预估 + 单列调试模式 + 结果缓存 |
| 提示词 / ToT / Reflexion token 消耗大 | 超时或超预算 | 限制最大步数 + token 上限 + 默认 temperature=0 |
| Self-Evolving 循环失控 | 无限循环 | 非 MVP；实装后最多 3 轮进化 + 每轮验证 |
| 不同框架 Tool 调用格式不统一 | 对比不公平 | `ToolRegistry` 统一 schema + Adapter 内转换 |
| Prompt Profile 与推理模式概念重叠 | 用户困惑 | UI 与文档区分「Prompt 层 CoT」vs「CoT+Tool 编排」 |
