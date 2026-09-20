/**
 * @file trajectory
 * @description Execution trajectory evaluation for agent comparison runs.
 *
 * Responsibilities:
 * - Evaluate the quality of full execution event traces across key dimensions:
 *   1. tool_efficiency: loops/repeats detection, tool failure rates, deadlocks
 *   2. planning_coherence: thought-to-action ratio, plan-before-act, reflection presence
 *   3. error_recovery: behavior after observation errors, resilience, self-healing
 *   4. step_economy: convergence speed, step budget utilization, wandering detection
 * - Provide pure deterministic trajectory judging without external dependencies
 * - Support optional async LLM trajectory judging behind the LlmJudgeAdapter seam
 */

import type {
  ArenaEvent,
  TrajectoryDimensionScore,
  TrajectoryJudge,
  TrajectoryJudgeAsyncOptions,
  TrajectoryJudgeOptions,
  TrajectoryScore,
} from "@agentprism/contracts";
import { sanitizeForJson, sanitizeErrorMessage } from "@agentprism/contracts";

const DEFAULT_PASS_THRESHOLD = 0.6;
const ERROR_INDICATOR_PATTERN = /(?:error|failed|exception|traceback|invalid|errno|not found|command not found)/i;

interface ExtractedSignals {
  totalEvents: number;
  thoughts: ArenaEvent[];
  actions: ArenaEvent[];
  observations: ArenaEvent[];
  reflects: ArenaEvent[];
  errors: ArenaEvent[];
  isSuccess: boolean;
  totalSteps: number;
  totalToolCalls: number;
  repeatedActions: Array<{ tool: string; argsStr: string; count: number }>;
  failedObservationIndices: number[];
  recoveredFromError: boolean;
  firstActionPrecededByThought: boolean;
}

/** Analyzes the event sequence to extract deterministic behavioral signals. */
function extractSignals(events: readonly ArenaEvent[]): ExtractedSignals {
  const thoughts: ArenaEvent[] = [];
  const actions: ArenaEvent[] = [];
  const observations: ArenaEvent[] = [];
  const reflects: ArenaEvent[] = [];
  const errors: ArenaEvent[] = [];

  let isSuccess = false;
  let totalSteps = 0;
  let totalToolCalls = 0;

  for (const event of events) {
    if (event.type === "thought" && event.content.trim() !== "") {
      thoughts.push(event);
    } else if (event.type === "action") {
      actions.push(event);
      totalToolCalls += 1;
    } else if (event.type === "observation") {
      observations.push(event);
    } else if (event.type === "reflect") {
      reflects.push(event);
    } else if (event.type === "error") {
      errors.push(event);
    } else if (event.type === "step_start") {
      totalSteps += 1;
    } else if (event.type === "complete") {
      if (event.metrics !== null) {
        if (event.metrics.success === true) isSuccess = true;
        if (event.metrics.steps > totalSteps) totalSteps = event.metrics.steps;
        if (event.metrics.tool_calls > totalToolCalls) totalToolCalls = event.metrics.tool_calls;
      }
    }
  }

  // Check whether the first action had a preceding thought
  let firstActionPrecededByThought = false;
  let seenThoughtBeforeAction = false;
  for (const event of events) {
    if (event.type === "thought" && event.content.trim() !== "" && !event.content.startsWith("[")) {
      seenThoughtBeforeAction = true;
    } else if (event.type === "action") {
      firstActionPrecededByThought = seenThoughtBeforeAction;
      break;
    }
  }

  // Detect consecutive or high-frequency identical actions (tool + args).
  // The signature pairs tool and args; args text is stored alongside so
  // evidence never depends on re-splitting (tool names may contain colons).
  const actionSignatureCounts = new Map<string, { tool: string; argsStr: string; count: number }>();
  let lastSignature = "";
  let consecutiveRepeats = 0;

  for (const action of actions) {
    const argsStr = JSON.stringify(action.args ?? {});
    const sig = `${action.tool}:${argsStr}`;
    const existing = actionSignatureCounts.get(sig);
    if (existing) {
      existing.count += 1;
    } else {
      actionSignatureCounts.set(sig, { tool: action.tool, argsStr, count: 1 });
    }

    if (sig === lastSignature) {
      consecutiveRepeats += 1;
    }
    lastSignature = sig;
  }

  const repeatedActions: Array<{ tool: string; argsStr: string; count: number }> = [];
  for (const data of actionSignatureCounts.values()) {
    if (data.count >= 3 || consecutiveRepeats > 0) {
      repeatedActions.push({ tool: data.tool, argsStr: data.argsStr, count: data.count });
    }
  }

  // Detect failed observations (index access is bounds-guarded; skips defensively).
  const failedObservationIndices: number[] = [];
  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i];
    if (obs === undefined) continue;
    if (typeof obs.result === "string" && ERROR_INDICATOR_PATTERN.test(obs.result.slice(0, 300))) {
      failedObservationIndices.push(i);
    }
  }

  // Check error recovery: if errors occurred, did the agent attempt subsequent thoughts/actions and succeed?
  const hasErrors = errors.length > 0 || failedObservationIndices.length > 0;
  const recoveredFromError = hasErrors && isSuccess;

  return {
    totalEvents: events.length,
    thoughts,
    actions,
    observations,
    reflects,
    errors,
    isSuccess,
    totalSteps: Math.max(totalSteps, actions.length),
    totalToolCalls,
    repeatedActions,
    failedObservationIndices,
    recoveredFromError,
    firstActionPrecededByThought,
  };
}

/** Evaluates tool calling efficiency, detecting deadlocks, loops, and excessive tool failures. */
function evaluateToolEfficiency(signals: ExtractedSignals): TrajectoryDimensionScore {
  let score = 1.0;
  const reasons: string[] = [];
  const evidence: string[] = [];

  if (signals.actions.length === 0) {
    return {
      dimension: "tool_efficiency",
      score: 1.0,
      weight: 0.25,
      reason: "No tool calls needed; direct solution.",
      evidence: ["Zero tools invoked."],
    };
  }

  // Penalty for repeated/looping action calls
  if (signals.repeatedActions.length > 0) {
    let penalty = 0;
    for (const rep of signals.repeatedActions) {
      if (rep.count >= 2) {
        penalty += 0.2 * (rep.count - 1);
        evidence.push(`Tool '${rep.tool}' called ${rep.count} times with identical arguments: ${rep.argsStr}`);
      }
    }
    penalty = Math.min(0.6, penalty);
    score -= penalty;
    if (penalty > 0) {
      reasons.push(`Detected repetitive or looping tool invocations (-${penalty.toFixed(2)}).`);
    }
  }

  // Penalty for high tool failure rates
  const failureRate = signals.observations.length > 0
    ? signals.failedObservationIndices.length / signals.observations.length
    : 0;

  if (failureRate > 0.6) {
    score -= 0.4;
    reasons.push(`High tool failure rate (${(failureRate * 100).toFixed(0)}% of tool outputs returned errors).`);
    evidence.push(`${signals.failedObservationIndices.length} out of ${signals.observations.length} tool calls produced errors.`);
  } else if (failureRate > 0.25) {
    score -= 0.2;
    reasons.push(`Moderate tool failure rate (${(failureRate * 100).toFixed(0)}% tool errors).`);
    evidence.push(`${signals.failedObservationIndices.length} tool errors observed.`);
  }

  score = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));

  return {
    dimension: "tool_efficiency",
    score,
    weight: 0.25,
    reason: reasons.length > 0 ? reasons.join(" ") : "Tools used efficiently with low error rate and no repetition loops.",
    evidence: evidence.length > 0 ? evidence : [`${signals.actions.length} tool call(s) executed smoothly.`],
  };
}

/** Evaluates reasoning and planning coherence throughout the execution. */
function evaluatePlanningCoherence(signals: ExtractedSignals): TrajectoryDimensionScore {
  let score = 1.0;
  const reasons: string[] = [];
  const evidence: string[] = [];

  // Plan before act check
  if (signals.actions.length > 0 && !signals.firstActionPrecededByThought) {
    score -= 0.25;
    reasons.push("First tool invoked before any explicit reasoning phase.");
    evidence.push("Action executed prior to thought event.");
  }

  // Thought presence and depth
  if (signals.thoughts.length === 0) {
    score -= 0.4;
    reasons.push("No thought events present in trajectory (pure action execution).");
    evidence.push("0 thought events recorded.");
  } else {
    const avgThoughtLength =
      signals.thoughts.reduce((sum, t) => sum + t.content.length, 0) / signals.thoughts.length;
    evidence.push(`${signals.thoughts.length} thought phase(s) with average length of ${Math.round(avgThoughtLength)} chars.`);
    if (avgThoughtLength < 25 && signals.actions.length > 2) {
      score -= 0.15;
      reasons.push("Thought phases are terse or lack actionable planning.");
    }
  }

  // Bonus for reflection and verification phases
  if (signals.reflects.length > 0) {
    evidence.push(`${signals.reflects.length} explicit reflection/deliberation event(s).`);
  }

  score = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));

  return {
    dimension: "planning_coherence",
    score,
    weight: 0.25,
    reason: reasons.length > 0 ? reasons.join(" ") : "Clear reasoning-before-action flow with coherent plan progression.",
    evidence,
  };
}

/** Evaluates resilience and error recovery when tool calls fail or exceptions occur. */
function evaluateErrorRecovery(signals: ExtractedSignals): TrajectoryDimensionScore {
  const hasErrors = signals.errors.length > 0 || signals.failedObservationIndices.length > 0;

  if (!hasErrors) {
    if (signals.isSuccess) {
      return {
        dimension: "error_recovery",
        score: 1.0,
        weight: 0.25,
        reason: "Flawless execution path; no operational errors or exceptions encountered.",
        evidence: ["Zero error events or failed observations."],
      };
    }
    return {
      dimension: "error_recovery",
      score: 0.5,
      weight: 0.25,
      reason: "No tool errors observed, but task execution did not succeed.",
      evidence: ["Run unsettled or failed without tool errors."],
    };
  }

  if (signals.recoveredFromError) {
    return {
      dimension: "error_recovery",
      score: 0.95,
      weight: 0.25,
      reason: "Successfully diagnosed error and self-healed to achieve a successful completion.",
      evidence: [
        `Encountered ${signals.failedObservationIndices.length} tool failure(s)/error(s) but adapted and completed successfully.`,
      ],
    };
  }

  // Error occurred and run was not successful
  let score = 0.3;
  if (signals.reflects.length > 0) {
    score = 0.45; // Attempted reflection before failing
  }

  return {
    dimension: "error_recovery",
    score,
    weight: 0.25,
    reason: "Encountered fatal errors or repeated tool failures without achieving successful recovery.",
    evidence: [
      `${signals.errors.length} fatal error event(s), ${signals.failedObservationIndices.length} failed tool observations.`,
    ],
  };
}

/** Evaluates step economy and whether the agent converged without excessive wandering. */
function evaluateStepEconomy(signals: ExtractedSignals): TrajectoryDimensionScore {
  let score = 1.0;
  const reasons: string[] = [];
  const evidence: string[] = [`Total steps: ${signals.totalSteps}, total tool calls: ${signals.totalToolCalls}.`];

  if (!signals.isSuccess) {
    score = 0.4;
    reasons.push("Task did not settle into a successful terminal state.");
  } else if (signals.totalSteps <= 8) {
    score = 1.0;
    reasons.push("Highly economical execution; solved in 8 or fewer steps.");
  } else if (signals.totalSteps <= 20) {
    score = 0.9;
    reasons.push("Good convergence speed within expected step budget.");
  } else if (signals.totalSteps <= 35) {
    score = 0.75;
    reasons.push("Moderate step overhead; required multiple iterations to converge.");
  } else {
    score = Math.max(0.3, 0.7 - ((signals.totalSteps - 35) / 50));
    reasons.push(`High step volume (${signals.totalSteps} steps); indicates wandering or struggle to converge.`);
  }

  score = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));

  return {
    dimension: "step_economy",
    score,
    weight: 0.25,
    reason: reasons.join(" "),
    evidence,
  };
}

/**
 * Pure deterministic trajectory evaluator.
 * Evaluates an execution event sequence across four orthogonal quality dimensions.
 */
export function evaluateTrajectory(
  events: readonly ArenaEvent[],
  options: TrajectoryJudgeOptions = {},
): TrajectoryScore {
  const threshold = options.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const signals = extractSignals(events);

  const dimEfficiency = evaluateToolEfficiency(signals);
  const dimPlanning = evaluatePlanningCoherence(signals);
  const dimRecovery = evaluateErrorRecovery(signals);
  const dimEconomy = evaluateStepEconomy(signals);

  const dimensions: Record<string, TrajectoryDimensionScore> = {
    tool_efficiency: dimEfficiency,
    planning_coherence: dimPlanning,
    error_recovery: dimRecovery,
    step_economy: dimEconomy,
  };

  const totalWeight = Object.values(dimensions).reduce((sum, d) => sum + d.weight, 0);
  const weightedScore = Object.values(dimensions).reduce((sum, d) => sum + d.score * d.weight, 0);
  const overall = Number((weightedScore / (totalWeight > 0 ? totalWeight : 1)).toFixed(2));
  const passed = signals.isSuccess && overall >= threshold;

  const highlights = Object.values(dimensions)
    .filter((d) => d.score >= 0.85)
    .map((d) => d.dimension);
  const deductions = Object.values(dimensions)
    .filter((d) => d.score < 0.6)
    .map((d) => `${d.dimension} (${d.score})`);

  let summary = `Trajectory score: ${overall.toFixed(2)} (${passed ? "PASS" : "FAIL"}).`;
  if (highlights.length > 0) {
    summary += ` Strong in: ${highlights.join(", ")}.`;
  }
  if (deductions.length > 0) {
    summary += ` Deductions in: ${deductions.join(", ")}.`;
  }

  return {
    overall,
    passed,
    dimensions,
    summary,
  };
}

/** Summarizes an event sequence into a compact textual trace for LLM evaluation. */
function buildTrajectoryTraceDigest(events: readonly ArenaEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === "thought" && event.content.trim() !== "" && !event.content.startsWith("[")) {
      lines.push(`THOUGHT: ${event.content.slice(0, 150)}`);
    } else if (event.type === "action") {
      lines.push(`ACTION: ${event.tool}(${JSON.stringify(event.args).slice(0, 120)})`);
    } else if (event.type === "observation") {
      lines.push(`OBSERVATION: ${event.result.slice(0, 120)}`);
    } else if (event.type === "reflect") {
      lines.push(`REFLECT: ${event.content.slice(0, 150)}`);
    } else if (event.type === "error") {
      lines.push(`ERROR: ${event.message.slice(0, 150)}`);
    } else if (event.type === "complete") {
      lines.push(`COMPLETE: success=${event.metrics?.success ?? false}, steps=${event.metrics?.steps ?? 0}`);
    }
  }
  return lines.slice(-25).join("\n");
}

/**
 * Async trajectory evaluator with optional LLM judge augmentation.
 * Falls back gracefully to the deterministic score if LLM invocation fails.
 */
export async function evaluateTrajectoryAsync(
  events: readonly ArenaEvent[],
  options: TrajectoryJudgeAsyncOptions = {},
): Promise<TrajectoryScore> {
  const deterministicScore = evaluateTrajectory(events, options);
  if (!options.adapter) {
    return deterministicScore;
  }

  try {
    const digest = buildTrajectoryTraceDigest(events);
    const prompt = [
      "You are an expert AI Agent trajectory evaluation judge.",
      "Evaluate the execution quality based on: tool efficiency, planning coherence, error recovery, and step economy.",
      `Question/Task: ${options.question ?? "(unspecified)"}`,
      "Execution Trace Digest:",
      digest,
      "",
      "Respond strictly with valid JSON conforming to this schema:",
      '{"overall": 0.0-1.0, "passed": true/false, "summary": "brief summary", "reason": "key reasoning"}',
    ].join("\n");

    const rawResponse = await options.adapter.invoke(prompt);
    const sanitized = sanitizeForJson(rawResponse);
    const parsed = JSON.parse(sanitized) as Record<string, unknown>;

    const overallRaw = parsed.overall;
    if (typeof overallRaw === "number" && Number.isFinite(overallRaw)) {
      const overall = Number(Math.max(0, Math.min(1, overallRaw)).toFixed(2));
      const passed = typeof parsed.passed === "boolean" ? parsed.passed : overall >= (options.passThreshold ?? DEFAULT_PASS_THRESHOLD);
      const summary = typeof parsed.summary === "string" && parsed.summary !== ""
        ? parsed.summary
        : deterministicScore.summary;

      return {
        overall,
        passed,
        dimensions: deterministicScore.dimensions,
        summary: `[LLM-Assisted] ${summary}`,
      };
    }
    return deterministicScore;
  } catch (error) {
    console.warn(`[evaluation] Async LLM trajectory judging failed: ${sanitizeErrorMessage(error)}; using deterministic score.`);
    return deterministicScore;
  }
}

/** Batch evaluation of multiple column trajectories. */
export function evaluateTrajectories(
  eventsByPipeline: Record<string, readonly ArenaEvent[]>,
  options: TrajectoryJudgeOptions = {},
): Record<string, TrajectoryScore> {
  const out: Record<string, TrajectoryScore> = {};
  for (const [label, events] of Object.entries(eventsByPipeline)) {
    out[label] = evaluateTrajectory(events, options);
  }
  return out;
}

/** Exportable TrajectoryJudge implementation satisfying the contracts port. */
export const deterministicTrajectoryJudge: TrajectoryJudge = {
  evaluateTrajectory,
  evaluateTrajectoryAsync,
};
