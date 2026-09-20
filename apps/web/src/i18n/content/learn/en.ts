/**
 * @file content/learn/en
 * @description English learn content compiled against the zh-CN shape.
 *
 * Responsibilities:
 * - Translate hero copy and the week plan
 *
 * Technical terms, dimension ids, and template ids stay in original form;
 * missing/extra fields are compile errors via LearnContent.
 */

import type { WeekStep } from "./types";
import type { LearnContent } from "./zh-CN";

/** Static copy of the hero header and the footer's advanced-guidance section. */
const page = {
  eyebrow: "LEARNING PATH",
  title: "Learning Path",
  intro:
    "Eight weeks, step by step: from understanding framework differences to per-turn multi-turn comparison, then to the decoding and capability dimensions like temperature / model / thinking level / toolset, finishing with an experiment report you produce independently. Every step maps to a real comparison experiment in Arena.",
  advanced: {
    title: "Going further",
    body: "The auto-scorable badge in the task-template library marks tasks with an objective pass criterion (parseable JSON, executable code, numeric matching, ...), ideal for checking whether Prompt / reasoning / Harness improvements actually help. For multi-turn experiments keep every turn's baseline identical, and read the Trace and report per turn.",
    link: { href: "/guide", label: "Dimensions" },
  },
};

/** Static curriculum data of the 8-week learning path, separated from the view (same page+data convention as the guide page). */
const weekSteps: ReadonlyArray<WeekStep> = [
  {
    week: 1,
    title: "Framework basics",
    goal: "Understand the orchestration differences between LangChain and LangGraph",
    items: [
      "Run one framework comparison: same question, same Prompt, same toolset",
      "Watch both columns' streaming Thought / Action / Observation output",
      "Read the comparison report: hard metrics such as duration, tokens and tool-call counts",
    ],
    dimension: "framework",
    template: "fibonacci_code",
  },
  {
    week: 2,
    title: "Prompt engineering",
    goal: "Understand the Zero-shot / Few-shot / CoT / Structured strategies",
    items: [
      "Use the \"JSON structured output\" template to compare zero_shot with structured",
      "Observe the format-compliance differences: does the structured Prompt really output valid JSON",
      "Check the auto-scoring column in the comparison report: which strategy passes more often?",
    ],
    dimension: "prompt",
    template: "json_profile",
  },
  {
    week: 3,
    title: "Reasoning modes",
    goal: "Compare how ReAct / CoT+Tool / ToT / Reflexion think",
    items: [
      "Use the \"primes below 100\" template to compare react with reflexion",
      "Observe the Thought chains: interleaving think-and-act vs thinking first, acting later",
      "Does the reflection mode self-correct when the answer is wrong",
    ],
    dimension: "reasoning",
    template: "prime_count",
  },
  {
    week: 4,
    title: "Multi-turn conversation",
    goal: "Master the shared messages history and per-turn segmented comparison",
    items: [
      "Ask 2–3 follow-ups on the same comparison columns: columns share history, only question changes",
      "Watch the Trace collapse by turn: is each turn's Thought / Action segmented independently",
      "Compare columns' memory consistency across turns: do they cite earlier conclusions",
    ],
    dimension: "context",
    template: "arithmetic_mix",
  },
  {
    week: 5,
    title: "Context engineering",
    goal: "Understand the sliding window / summary / vector / hybrid / tool-tail / token-budget memory strategies",
    items: [
      "On top of multi-turn, compare sliding with summary: is early-turn information retained",
      "Use the \"minutes until midnight\" template (requires multi-turn tool calls)",
      "Watch the files the agent writes in the workspace panel, paired with vector retrieval",
    ],
    dimension: "context",
    template: "time_until_midnight",
  },
  {
    week: 6,
    title: "Harness engineering",
    goal: "Experience the evolution from bare run → verify → reflect → self-evolve",
    items: [
      "Use the \"refusal detection\" template to compare bare with verify",
      "Watch the verify loop: does it rerun when the answer falls short",
      "How would the self-evolve mode modify its own system prompt",
    ],
    dimension: "harness",
    template: "no_refusal",
  },
  {
    week: 7,
    title: "Decoding and models",
    goal: "Isolate the effect of temperature, thinking level and endpoints on output quality",
    items: [
      "Compare temperature 0 vs 0.7: run the same task twice and observe stability vs creativity",
      "If Settings has multiple endpoints, compare the model dimension; pin temperature and the thinking tier in the baseline",
      "On thinking-capable models, compare thinking off vs medium and watch the thinking event stream",
    ],
    dimension: "temperature",
    template: "builtin_types",
  },
  {
    week: 8,
    title: "Tools & steps · Capstone",
    goal: "Control tool availability and loop depth, and complete an experiment report independently",
    items: [
      "Compare toolset full vs read_only: watch how the agent degrades when tools are restricted",
      "Compare max_steps 5 vs 15: does the complex task produce an answer within the step budget",
      "With a custom task or multi-turn follow-ups, rerun at least twice and read TraceDiff and scores per turn",
      "Save the results as a project to build an experiment archive",
    ],
    dimension: "toolset",
    template: "quick_files",
  },
];

/** Entry links derive from dimension + template, avoiding the same fact encoded twice inline. */
const weekPlan: ReadonlyArray<WeekStep & { href: string }> = weekSteps.map((step) => ({
  ...step,
  href: `/arena?dimension=${step.dimension}&template=${step.template}`,
}));

/** The single learn content object for en; structurally identical to the zh-CN source of truth. */
export const learnContent: LearnContent = {
  page,
  weekPlan,
};
