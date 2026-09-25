/**
 * @file reasoning-support
 * @description Framework × reasoning-mode support table (single source).
 *
 * Responsibilities:
 * - Declare how deeply each driver interprets the reasoning mode
 * - Keep the "which columns does reasoning really rewire" answer reviewable
 *
 * Levels: structural (control flow branches per mode), budget (same loop,
 * retry budgets vary), prompt (shared prompt suffix only), skeleton (tool
 * calling loop; reasoning rides the system prompt text alone). The table is
 * descriptive, not prescriptive: drivers implement; this module documents so
 * the reasoning dimension is never misread as structural everywhere.
 */

import type { ReasoningMode } from "@agentprism/contracts";

/** Depth at which a driver interprets the reasoning mode. */
export type ReasoningSupportLevel = "structural" | "budget" | "prompt" | "skeleton";

/** Per-framework reasoning support declaration. */
export interface ReasoningSupport {
  frameworkId: string;
  level: ReasoningSupportLevel;
  /** Which modes change behavior (empty means none do). */
  modes: readonly ReasoningMode[];
  note: string;
}

/** Framework × reasoning support table (mirrors the builtin loader list). */
export const REASONING_SUPPORT: readonly ReasoningSupport[] = [
  {
    frameworkId: "native",
    level: "structural",
    modes: ["react", "cot_tool", "tot", "reflexion", "self_consistency"],
    note: "Phase machine gates tool binding and termination per mode; self-consistency runs N independent attempts, each with its own max_steps budget.",
  },
  {
    frameworkId: "langgraph",
    level: "structural",
    modes: ["react", "cot_tool", "tot", "reflexion", "self_consistency"],
    note: "One compiled reasoning graph per mode over the shared bridge; self-consistency loops the react graph N times, each attempt with its own max_steps budget.",
  },
  {
    frameworkId: "plan_execute",
    level: "structural",
    modes: ["react", "cot_tool", "tot", "reflexion"],
    note: "Planner reshapes per mode (tot branches and scores candidates); reflexion doubles replan budgets.",
  },
  {
    frameworkId: "self_critique",
    level: "budget",
    modes: ["reflexion"],
    note: "Same critic loop every mode; reflexion grants one extra redirect.",
  },
  {
    frameworkId: "langchain",
    level: "skeleton",
    modes: [],
    note: "Tool-calling skeleton; reasoning rides the shared system prompt text alone.",
  },
  {
    frameworkId: "autogen",
    level: "budget",
    modes: ["react", "reflexion"],
    note: "Same group chat every mode; reflexion grants one extra reviewer round.",
  },
  {
    frameworkId: "crewai",
    level: "budget",
    modes: ["react", "reflexion"],
    note: "Same crew pipeline every mode; reflexion grants one extra worker turn per task.",
  },
];

/** Looks up a framework's support declaration (undefined when unregistered). */
export function reasoningSupportFor(frameworkId: string): ReasoningSupport | undefined {
  return REASONING_SUPPORT.find((entry) => entry.frameworkId === frameworkId);
}
