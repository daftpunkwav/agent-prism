"use client";

import Link from "next/link";
import { ArrowRight, Compass, Flag, Lightbulb, Route } from "lucide-react";

/** 8 周学习路径。每步关联具体 Arena 实验，含多轮对话与解码/工具维。 */
const WEEK_PLAN = [
  {
    week: 1,
    title: "框架入门",
    goal: "看懂 LangChain 与 LangGraph 的编排差异",
    items: [
      "跑一次框架对比：同一问题、同一 Prompt、同一工具集",
      "观察两列的 Thought / Action / Observation 流式输出",
      "读对比报告：耗时、Token、工具调用次数等硬指标",
    ],
    dimension: "framework",
    href: "/arena?dimension=framework&template=fibonacci_code",
  },
  {
    week: 2,
    title: "提示词工程",
    goal: "理解 Zero-shot / Few-shot / CoT / Structured 四种策略",
    items: [
      "用「JSON 结构化输出」模板对比 zero_shot 与 structured",
      "观察格式遵从差异：结构化 Prompt 是否真的输出合法 JSON",
      "对比报告中的自动判分列：哪种策略通过率高？",
    ],
    dimension: "prompt",
    href: "/arena?dimension=prompt&template=json_profile",
  },
  {
    week: 3,
    title: "推理模式",
    goal: "对比 ReAct / CoT+Tool / ToT / Reflexion 的思考方式",
    items: [
      "用「100 以内质数」模板对比 react 与 reflexion",
      "观察 Thought 链条：边想边做 vs 先想后做",
      "反思模式在答案错误时是否会自我纠错",
    ],
    dimension: "reasoning",
    href: "/arena?dimension=reasoning&template=prime_count",
  },
  {
    week: 4,
    title: "多轮对话",
    goal: "掌握共享 messages 历史与按轮次分段对比",
    items: [
      "在同一组对比列上连续追问 2–3 轮：各列共享历史，仅 question 变化",
      "观察 Trace 按 turn 折叠：每轮 Thought / Action 是否独立分段",
      "对比不同列在多轮中的「记忆一致性」：是否引用前轮结论",
    ],
    dimension: "context",
    href: "/arena?dimension=context&template=arithmetic_mix",
  },
  {
    week: 5,
    title: "上下文工程",
    goal: "理解滑动窗口 / 摘要 / 向量 / 混合四种 Memory 策略",
    items: [
      "在多轮基础上对比 sliding 与 summary：早期轮次信息是否被保留",
      "使用「距离午夜分钟数」模板（需调用工具多轮）",
      "观察工作空间面板中 Agent 写下的文件，配合 vector 策略检索",
    ],
    dimension: "context",
    href: "/arena?dimension=context&template=time_until_midnight",
  },
  {
    week: 6,
    title: "Harness 工程",
    goal: "体验裸运行 → 验证 → 反思 → 自进化的演进",
    items: [
      "用「拒绝检测」模板对比 bare 与 verify",
      "观察验证循环：答案不达标时是否会重跑",
      "自进化模式会如何修改自己的 system prompt",
    ],
    dimension: "harness",
    href: "/arena?dimension=harness&template=no_refusal",
  },
  {
    week: 7,
    title: "解码与模型",
    goal: "隔离温度、思考强度与接入点对输出质量的影响",
    items: [
      "对比 temperature 0 vs 0.7：同一任务跑两次，观察稳定性与创造性",
      "若 Settings 配置了多个接入点，对比 model 维；基线钉死温度与思考档位",
      "对支持思考的模型，对比 thinking off vs medium，观察 thinking 事件流",
    ],
    dimension: "temperature",
    href: "/arena?dimension=temperature&template=builtin_types",
  },
  {
    week: 8,
    title: "工具与步数 · 综合实战",
    goal: "控制工具可用性与循环深度，独立完成实验报告",
    items: [
      "对比 toolset full vs calc_time：观察工具受限时 Agent 如何降级",
      "对比 max_steps 5 vs 15：复杂任务是否在步数上限前给出答案",
      "自定义任务或多轮追问，复跑 2 次以上，按轮阅读 TraceDiff 与判分",
      "把结果保存为项目，形成实验档案",
    ],
    dimension: "toolset",
    href: "/arena?dimension=toolset&template=quick_files",
  },
];

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 learn-page">
      <div>
        <p className="eyebrow mb-2">LEARNING PATH</p>
        <h1 className="page-title">学习路径</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          八周循序渐进：从「看懂框架差异」到「多轮对话按轮对比」，再到温度 / 模型 / 思考强度 / 工具集等解码与能力维，
          最后独立完成实验报告。每一步都对应 Arena 里的真实对比实验。
        </p>
      </div>

      <div className="spectrum-line-soft" aria-hidden />

      <div className="grid gap-4 md:grid-cols-2 stagger-children">
        {WEEK_PLAN.map((step) => (
          <section
            key={step.week}
            className="panel-surface panel-lift learn-week-card flex flex-col gap-3 p-5"
            data-lane={(step.week - 1) % 4}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="learn-week-badge font-mono text-[10px] font-semibold border border-current rounded-md px-1.5 py-0.5"
                  aria-hidden
                >
                  W{step.week}
                </span>
                <h2 className="font-semibold text-sm">{step.title}</h2>
              </div>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground shrink-0">
                <Compass className="h-3 w-3" />
                {step.dimension}
              </span>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {step.goal}
            </p>

            <ul className="space-y-1.5 text-xs">
              {step.items.map((item) => (
                <li key={item} className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" aria-hidden />
                  <span className="text-muted-foreground leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-2">
              <Link
                href={step.href}
                className="btn-primary !w-full justify-center"
                aria-label={`开始第 ${step.week} 周：${step.title}`}
              >
                开始这一步
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        ))}
      </div>

      <section className="panel-surface p-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Route className="mt-0.5 h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">进阶方向</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              任务模板库的「可自动判分」徽章表示该任务有客观通过标准（JSON 可解析、代码可执行、数字匹配…），
              适合检验 Prompt / 推理 / Harness 的改进是否真的有效。多轮实验请保持每轮基线一致，按 turn 阅读 Trace 与报告。
            </p>
          </div>
        </div>
        <Link href="/guide" className="btn-ghost shrink-0">
          <Lightbulb className="h-4 w-4" />
          维度说明
        </Link>
      </section>
    </div>
  );
}
