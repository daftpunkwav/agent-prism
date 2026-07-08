# AgentPrism PRD — 产品需求文档

## 1. 产品概述

### 1.1 产品定义

AgentPrism 是一个 Agent 对比实验台（Arena）。用户输入一个问题或任务，系统同时启动多条 Agent 管线并行运行，实时流式展示每个 Agent 的推理过程、工具调用、中间结果，最终汇总对比报告。

核心隐喻：**棱镜（Prism）** —— 一束白光（用户问题）穿过棱镜，折射出光谱（多维度 Agent 实现）。

### 1.2 目标用户

| 用户类型 | 痛点 | AgentPrism 如何解决 |
|---------|------|-------------------|
| Agent 开发初学者 | 框架太多不知道选哪个 | 同一问题四个框架并跑，差异直观可见 |
| 求职者（Agent 方向） | 面试被问"为什么选这个框架"说不清 | 亲手跑过对比，有数据有体感 |
| 技术选型者 | 选框架靠感觉，没有量化依据 | 对比报告有准确率/速度/token 消耗数据 |
| Agent 研究者 | 缺少可控实验环境 | 四维切换、参数可调、Trace 可回放 |

### 1.3 核心价值主张

> **同一个问题，四条管线并行跑，差异一目了然。**

不教你怎么用某个框架，而是让你**看懂框架之间的本质差异**，从而做出有依据的选择。

---

## 2. 核心功能

### 2.1 Arena 实验台

#### 2.1.1 四列并行运行

用户输入问题后，四个 Agent 同时启动，各自独立运行。每个 Agent 列实时流式展示：

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

#### 2.1.2 四个对比维度

用户通过顶部 Tab 切换对比维度，同一问题在不同维度下展示不同切面：

**维度一：框架对比**

| 列 | 框架 | 编排方式 | 核心特点 |
|----|------|---------|---------|
| 1 | LangChain | AgentExecutor + Tools | 最早最全，ReAct 为主 |
| 2 | LangGraph | StateGraph + Nodes | 图编排，灵活状态管理 |
| 3 | AutoGen | GroupChat + Agents | 多Agent对话协作 |
| 4 | CrewAI | Crew + Tasks + Agents | 角色化分工，简单易用 |

**维度二：推理模式对比**

| 列 | 模式 | 流程 | 适用场景 |
|----|------|------|---------|
| 1 | ReAct | Thought→Action→Observation 循环 | 通用工具调用 |
| 2 | CoT+Tool | 先推理链再调工具 | 需要深度推理后再行动 |
| 3 | ToT | 多分支探索→评估→选最优 | 多解空间搜索 |
| 4 | Reflexion | 执行→评估→反思→重试 | 需要自我纠错的任务 |

**维度三：上下文策略对比**

| 列 | 策略 | 机制 | 优劣 |
|----|------|------|------|
| 1 | 滑动窗口 | 保留最近 N 条消息 | 简单但丢失早期信息 |
| 2 | 摘要压缩 | 超阈值时对旧消息做摘要 | 信息保留好但有摘要损失 |
| 3 | 向量检索 | 按 embedding 相似度检索历史 | 相关性强但缺少时序 |
| 4 | 混合策略 | 摘要 + 向量 + 滑动窗口 | 综合最优但复杂 |

**维度四：Harness 对比**

| 列 | Harness 级别 | 特征 |
|----|-------------|------|
| 1 | 裸运行 | 无验证循环，LLM 输出即最终结果 |
| 2 | 验证循环 | 有 Verify 步骤，不通过则重试 |
| 3 | 反思循环 | Verify + Reflect，基于失败原因调整策略 |
| 4 | 自进化 | Verify + Reflect + Harness 自修改 |

#### 2.1.3 对比报告

四列运行完成后，生成结构化对比报告：

```json
{
  "question": "分析 Python GIL 对多线程性能的影响",
  "dimension": "framework",
  "results": [
    {
      "label": "LangChain",
      "success": true,
      "duration_ms": 12300,
      "total_tokens": 2100,
      "tool_calls": 3,
      "steps": 5,
      "answer_quality": {
        "accuracy": 0.85,
        "completeness": 0.78,
        "grounding": 0.90
      }
    }
  ],
  "ranking": ["LangGraph", "LangChain", "CrewAI", "AutoGen"]
}
```

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
| 第1周 | 框架入门 | 跑框架对比维度，看生成代码 |
| 第2周 | 推理模式 | 跑推理模式对比，理解 Thought 差异 |
| 第3周 | 上下文工程 | 跑上下文策略对比，观察信息丢失 |
| 第4周 | Harness 工程 | 在 Harness Lab 中组装并对比 |
| 第5周 | 综合实战 | 自定义任务 + 自定义 Harness，独立完成 |

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
│  │             │  │ (4并行)     │  │ 结果汇总             │ │
│  │ 框架/推理/  │  │             │  │ 指标计算             │ │
│  │ 上下文/     │  │ LangChain   │  │ 排名生成             │ │
│  │ Harness    │  │ LangGraph   │  │ 报告输出             │ │
│  │ 路由选择   │  │ AutoGen     │  │                      │ │
│  └─────────────┘  │ CrewAI      │  └──────────────────────┘ │
│                    └─────────────┘                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Reasoning   │  │ Context     │  │ Harness              │ │
│  │ Engine      │  │ Engine      │  │ Engine               │ │
│  │             │  │             │  │                      │ │
│  │ ReAct       │  │ Sliding     │  │ Bare Run             │ │
│  │ CoT+Tool    │  │ Summary     │  │ Verify Loop          │ │
│  │ ToT         │  │ Vector      │  │ Reflect Loop         │ │
│  │ Reflexion   │  │ Hybrid      │  │ Self-Evolve          │ │
│  └─────────────┘  └─────────────┘  └──────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    Infrastructure                            │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ LLM      │ │ Vector   │ │ Trace    │ │ MCP            │ │
│  │ Router   │ │ Store    │ │ Store    │ │ Registry       │ │
│  │ (LiteLLM)│ │ (Chroma) │ │ (SQLite) │ │                │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Arena Engine 详细设计

#### 3.2.1 Dimension Router

根据用户选择的对比维度，将同一个用户问题路由到对应的四条管线：

```python
class DimensionRouter:
    def route(self, question: str, dimension: str) -> list[PipelineConfig]:
        if dimension == "framework":
            return [
                PipelineConfig(framework="langchain", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="autogen", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="crewai", reasoning="react", context="sliding", harness="bare"),
            ]
        elif dimension == "reasoning":
            return [
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="cot_tool", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="tot", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="reflexion", context="sliding", harness="bare"),
            ]
        elif dimension == "context":
            return [
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="react", context="summary", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="react", context="vector", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="react", context="hybrid", harness="bare"),
            ]
        elif dimension == "harness":
            return [
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="bare"),
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="verify"),
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="reflect"),
                PipelineConfig(framework="langgraph", reasoning="react", context="sliding", harness="self_evolve"),
            ]
```

**设计原则**：对比某个维度时，其他维度保持一致（控制变量法）。只有被对比的维度变化，其余维度使用默认值。

#### 3.2.2 Runner Pool

四条管线并行运行，每条管线独立：

```python
class RunnerPool:
    async def run_parallel(self, configs: list[PipelineConfig], question: str) -> list[RunResult]:
        tasks = [self._run_single(config, question) for config in configs]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return results

    async def _run_single(self, config: PipelineConfig, question: str) -> RunResult:
        pipeline = PipelineFactory.create(config)
        trace = []
        async for event in pipeline.astream(question):
            trace.append(event)
            yield SSEEvent(config.label, event)
        return RunResult(config=config, trace=trace)
```

#### 3.2.3 四引擎设计

**Reasoning Engine** — 四种推理模式：

| 模式 | 实现 | LangGraph 编排 |
|------|------|---------------|
| ReAct | Thought→Action→Observation 循环 | `agent_node → tool_node → agent_node → ...` |
| CoT+Tool | 先 CoT 推理链，再一次性调用工具 | `think_node → act_node → observe_node` |
| ToT | 生成 N 个候选→评估→选 top-K→继续 | `generate_node → evaluate_node → select_node → (循环)` |
| Reflexion | 执行→评估→反思→重试 | `execute_node → evaluate_node → reflect_node → (循环)` |

**Context Engine** — 四种上下文策略：

| 策略 | 实现 |
|------|------|
| 滑动窗口 | 保留最近 N 条消息，丢弃更早的 |
| 摘要压缩 | 超过 token 阈值时，对旧消息调用 LLM 生成摘要，替换原始消息 |
| 向量检索 | 每条消息 embedding 存入 Chroma，按当前问题检索 top-K 相关历史 |
| 混合策略 | 最近 N 条 + 向量检索 top-K + 旧消息摘要，三者合并去重 |

**Harness Engine** — 四级 Harness：

| 级别 | 实现 |
|------|------|
| Bare Run | LLM 输出直接返回，无验证 |
| Verify Loop | LLM 输出 → Verifier 检查 → 不通过则重试（最多 3 次） |
| Reflect Loop | Verify 不通过 → Reflector 分析原因 → 生成新策略 → 重试 |
| Self-Evolve | Reflect 后还修改自身 Harness 配置（Prompt / Tool 选择 / 控制流参数）→ 验证修改有效 → 应用 |

### 3.3 数据模型

```python
class Run(Base):
    id: str                      # 运行 ID
    question: str                # 用户问题
    dimension: str               # 对比维度
    created_at: datetime         # 创建时间
    user_id: str                 # 用户 ID

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
    trace: list[dict]            # 完整 Trace

class ComparisonReport(Base):
    id: str                      # 报告 ID
    run_id: str                  # 所属 Arena 运行
    dimension: str               # 对比维度
    ranking: list[str]           # 排名
    metrics: dict                # 各管线指标
    analysis: str                # LLM 生成的对比分析

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

- 顶部：维度切换 Tab（框架 / 推理模式 / 上下文策略 / Harness）
- 中部：四列并排，每列一个 Agent 运行流式输出
- 底部：输入框 + 发送按钮
- 运行结束后：对比报告折叠面板

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

- **指标表格**：四列的耗时/token/步数/工具调用并排对比
- **雷达图**：准确率/完整性/效率/成本 四维雷达图
- **LLM 分析**：自动生成一段对比分析文字
- **Trace 对比**：关键步骤的决策差异高亮

---

## 6. 非功能性需求

| 需求 | 指标 |
|------|------|
| 并行运行延迟 | 四管线并行，总耗时 ≈ 最慢单管线（非4倍） |
| SSE 流式延迟 | 每个事件 < 200ms 到达前端 |
| 单次运行超时 | 默认 120s，可配置 |
| Trace 存储 | SQLite，单次运行约 50-200KB |
| 并发用户 | 支持多用户同时运行不同 Arena |

---

## 7. MVP 范围

### Phase 1：Arena 核心（2周）

- [ ] Arena Engine：DimensionRouter + RunnerPool
- [ ] 框架对比维度：LangChain + LangGraph 实现（2列先跑通）
- [ ] SSE 流式输出
- [ ] 前端四列并排 UI
- [ ] 基础指标收集（耗时/token/步数）

### Phase 2：四维度全开（2周）

- [ ] AutoGen + CrewAI 适配
- [ ] 推理模式引擎：ReAct / CoT+Tool / ToT / Reflexion
- [ ] 上下文引擎：四种策略
- [ ] Harness 引擎：四级 Harness

### Phase 3：对比报告 + Trace（1周）

- [ ] 对比报告生成
- [ ] Trace 存储与回放
- [ ] 雷达图可视化

### Phase 4：Harness Lab（2周）

- [ ] Harness Primitive 定义与组合
- [ ] Harness 可视化编辑器
- [ ] Self-Evolving Harness 三阶段循环
- [ ] YAML 导入导出

### Phase 5：MCP + 学习路径（1周）

- [ ] MCP Server 暴露工具
- [ ] MCP Client 桥接外部工具
- [ ] 任务模板库
- [ ] 学习路径引导

---

## 8. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 主编排框架 | LangGraph | StateGraph 天然适合对比实验的多分支并行编排 |
| 推理模式引擎 | 自研，基于 LangGraph 节点组合 | 四种模式需要统一接口，各框架的推理实现差异太大无法直接对比 |
| 上下文引擎 | 自研，替换 LangChain 的 Memory 抽象 | 需要精确控制对比变量，LangChain 内置 Memory 行为不可控 |
| LLM 调用 | LiteLLM 统一封装 | BYOK + 多模型路由 + 降级链 |
| 向量存储 | Chroma（本地） | 零配置，适合单机开发 |
| Trace 存储 | SQLite | 轻量，单文件，足够 MVP |
| 前端 | Next.js 15 + SSE | 与 InterviewOS/RepoPilot 技术栈一致 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AutoGen/CrewAI 接口变化 | 适配工作量大 | 封装适配层，隔离框架变化 |
| 四管线并行 LLM 调用费用高 | 用户体验差 | 提供单列模式（一次只跑一个）+ 结果缓存 |
| ToT/Reflexion token 消耗大 | 超时或超预算 | 限制最大步数 + 设置 token 上限 |
| Self-Evolving 循环失控 | 无限循环 | 最多 3 轮进化 + 每轮必须通过验证 |
| 不同框架工具调用格式不统一 | 对比不公平 | 统一 Tool 接口层，各框架适配器转换 |
