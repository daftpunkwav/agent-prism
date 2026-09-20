/**
 * @file reasoning-state
 * @description Native control-flow state machine for reasoning modes.
 *
 * Responsibilities:
 * - Track phase transitions for cot_tool/tot/reflexion
 * - Gate tool binding and decide loop termination
 *
 * Real control flow plus phase prompts. ToT branches for real: totWidth
 * independent candidate-generation calls, each scored by its own tool-free
 * call, winner by deterministic argmax (one-level branching).
 */

import type { LlmAssistantMessage, LlmMessage, ReasoningMode } from "@agentprism/contracts";
import { parseScoreVerdict, REFLEXION_RETRY_KEYWORDS, TOT_WIDTH_DEFAULT } from "@agentprism/driver-registry";

export type ReasoningPhase = "think" | "act" | "evaluate" | "reflect" | "done";

/** Native control-flow state machine (real control flow plus phase prompt hints). */
export interface ReasoningState {
  mode: ReasoningMode;
  phase: ReasoningPhase;
  /** ToT candidate plans (one per branch call). */
  plans: string[];
  /** ToT branch scores, parallel to plans (unparsable replies score 0). */
  scores: number[];
  selectedPlan: string;
  reflections: string[];
  cotDone: boolean;
  /** Index of the ToT branch currently being generated/scored (0-based). */
  totRound: number;
  totWidth: number;
  reflexionRound: number;
  maxReflexion: number;
}

/**
 * Creates reasoning state for one native run (phase derives from the mode).
 *
 * @param mode Reasoning strategy selecting the initial phase and tool gating.
 * @param options Optional overrides; totWidth clamps to at least 1 branch.
 * @returns Fresh state with empty plans, scores, and reflections.
 */
export function createReasoningState(mode: ReasoningMode, options?: { totWidth?: number }): ReasoningState {
  const initialPhase = mode === "cot_tool" || mode === "tot" ? "think" : "act";
  return {
    mode,
    phase: initialPhase,
    plans: [],
    scores: [],
    selectedPlan: "",
    reflections: [],
    cotDone: false,
    totRound: 0,
    totWidth: Math.max(1, options?.totWidth ?? TOT_WIDTH_DEFAULT),
    reflexionRound: 0,
    maxReflexion: 2,
  };
}

/** Whether tool binding is allowed in the current phase. */
export function shouldBindTools(state: ReasoningState): boolean {
  if (state.mode === "cot_tool" && !state.cotDone) return false;
  if (state.mode === "tot" && (state.phase === "think" || state.phase === "evaluate")) return false;
  if (state.phase === "reflect") return false;
  return true;
}

/** Phase hints as neutral user messages (avoids multiple system messages). */
export function phaseHint(state: ReasoningState): LlmMessage[] {
  if (state.mode === "cot_tool" && state.phase === "think") {
    return [{ role: "user", content: "[Phase: CoT] Reason only; do not call tools. List a plan before acting." }];
  }
  if (state.mode === "tot" && state.phase === "think") {
    return [
      {
        role: "user",
        content: `[Phase: ToT branch ${state.totRound + 1}/${state.totWidth}] Propose ONE distinct solution approach (at most 4 steps). Do not call tools.`,
      },
    ];
  }
  if (state.mode === "tot" && state.phase === "evaluate") {
    const plan = state.plans[state.totRound] ?? "(none)";
    return [
      {
        role: "user",
        content:
          `[Phase: ToT score ${state.totRound + 1}/${state.totWidth}] Score this plan 0-10 for likelihood of completing the task. ` +
          `Reply with "SCORE: <0-10>" then one line of reasoning.\nPlan:\n${plan}`,
      },
    ];
  }
  if (state.mode === "reflexion" && state.phase === "reflect") {
    return [
      {
        role: "user",
        content:
          "[Phase: Reflect] Evaluate whether the current result completes the task; if insufficient, say what to improve or redo.",
      },
    ];
  }
  return [];
}

/** Selects the argmax-scored candidate index (ties break to the earliest). */
export function selectBestPlan(plans: string[], scores: number[]): number {
  let best = 0;
  for (let index = 1; index < plans.length && index < scores.length; index += 1) {
    if ((scores[index] ?? 0) > (scores[best] ?? 0)) best = index;
  }
  return best;
}

/** Phase transition after one LLM response (mutates and returns the same state). */
export function afterLlm(
  state: ReasoningState,
  response: LlmAssistantMessage,
  hadToolCalls: boolean,
): ReasoningState {
  const content = response.content;

  if (state.mode === "cot_tool" && state.phase === "think" && !hadToolCalls) {
    state.cotDone = true;
    state.phase = "act";
    return state;
  }
  if (state.mode === "tot" && state.phase === "think" && !hadToolCalls) {
    state.plans.push(content.slice(0, 800));
    state.phase = "evaluate";
    return state;
  }
  if (state.mode === "tot" && state.phase === "evaluate" && !hadToolCalls) {
    state.scores.push(parseScoreVerdict(content) ?? 0);
    state.totRound += 1;
    if (state.totRound < state.totWidth) {
      state.phase = "think";
      return state;
    }
    const best = selectBestPlan(state.plans, state.scores);
    state.selectedPlan = state.plans[best] ?? "";
    state.phase = "act";
    return state;
  }
  if (state.mode === "reflexion" && state.phase === "reflect" && !hadToolCalls) {
    state.reflections.push(content.slice(0, 500));
    const needRetry = REFLEXION_RETRY_KEYWORDS.some((keyword) => content.includes(keyword));
    if (needRetry && state.reflexionRound < state.maxReflexion) {
      state.reflexionRound += 1;
      state.phase = "act";
    } else {
      state.phase = "done";
    }
    return state;
  }
  if (!hadToolCalls && state.phase === "act") {
    if (state.mode === "reflexion" && state.reflexionRound < state.maxReflexion) {
      state.phase = "reflect";
    } else {
      state.phase = "done";
    }
  }
  return state;
}

/** True once the state machine reaches the done phase. */
export function isFinished(state: ReasoningState): boolean {
  return state.phase === "done";
}
