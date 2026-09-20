/**
 * @file ablation
 * @description Behavior-ablation rows: per-column tool/judge profiles for comparisons.
 *
 * Responsibilities:
 * - Reduce each column's event stream to countable behavior signals
 * - Compare rows so "did X matter" has numbers, not impressions
 *
 * Pure and deterministic (no model): MCP share counts `mcp__*` action events,
 * skill reads count `skill` (read) actions, reflects count deliberation events,
 * observation volume sums observation payloads. Judge verdicts arrive from the
 * caller (template judging lives in arena-service, not here).
 */

import type { AblationRow, ArenaEvent } from "@agentprism/contracts";
import { extractAnswerFromEvents } from "@agentprism/contracts";

/** Judging input per column: extracted answer text plus optional pass verdict. */
export interface AblationColumnInput {
  events: ArenaEvent[];
  /** Pre-extracted answer; defaults to extractAnswerFromEvents(events). */
  answer?: string;
  /** Judge verdict when the run was scored (null when unscored). */
  judgePassed?: boolean | null;
  /** Evaluated trajectory score [0, 1] if trajectory judging was executed. */
  trajectoryScore?: number | null;
  /** Terminal success fallback when no complete metrics exist. */
  success?: boolean;
}

/** Reduces one column's stream to an ablation row (never throws on odd streams). */
export function ablateColumn(label: string, input: AblationColumnInput): AblationRow {
  const events = Array.isArray(input.events) ? input.events : [];
  let toolCalls = 0;
  let mcpCalls = 0;
  let skillReads = 0;
  let delegations = 0;
  let reflects = 0;
  let observationChars = 0;
  for (const event of events) {
    if (event.type === "action") {
      toolCalls += 1;
      const tool = typeof event.tool === "string" ? event.tool : "";
      if (tool.startsWith("mcp__")) mcpCalls += 1;
      if (tool === "skill") skillReads += 1;
      if (tool === "subagent" || tool === "ralph_loop") delegations += 1;
    } else if (event.type === "reflect") {
      reflects += 1;
    } else if (event.type === "observation") {
      observationChars += typeof event.result === "string" ? event.result.length : 0;
    }
  }
  let answer = "";
  try {
    answer = input.answer ?? extractAnswerFromEvents(events);
  } catch {
    answer = input.answer ?? "";
  }
  const success =
    input.success ??
    events.some((event) => event.type === "complete" && (event.metrics?.success === true));
  return {
    label,
    tool_calls: toolCalls,
    mcp_calls: mcpCalls,
    mcp_share: toolCalls === 0 ? 0 : mcpCalls / toolCalls,
    skill_reads: skillReads,
    delegations,
    reflects,
    observation_chars: observationChars,
    answer_chars: answer.length,
    judge_passed: input.judgePassed ?? null,
    trajectory_score: input.trajectoryScore ?? null,
    success,
  };
}

/**
 * Ablates every column, sorted by label for stable reports.
 * Labels key the input map (same aggregation key as hard metrics).
 */
export function ablateComparison(columns: Record<string, AblationColumnInput>): AblationRow[] {
  return Object.keys(columns)
    .sort()
    .map((label) => ablateColumn(label, columns[label] as AblationColumnInput));
}

/** One-paragraph read-out of the ablation rows (for logs and narrative grounding). */
export function ablationSummary(rows: AblationRow[]): string {
  if (rows.length === 0) return "(no columns ablated)";
  const lines = rows.map((row) => {
    const judge = row.judge_passed === null ? "unscored" : row.judge_passed ? "pass" : "FAIL";
    const traj = typeof row.trajectory_score === "number" ? ` traj=${row.trajectory_score.toFixed(2)}` : "";
    return (
      `${row.label}: tools=${row.tool_calls} mcp_share=${row.mcp_share.toFixed(2)} ` +
      `skill_reads=${row.skill_reads} delegations=${row.delegations} reflects=${row.reflects} obs_chars=${row.observation_chars}${traj} judge=${judge}`
    );
  });
  const passed = rows.filter((row) => row.judge_passed === true).length;
  const scored = rows.filter((row) => row.judge_passed !== null).length;
  return [...lines, `judge: ${passed}/${scored} columns passed`].join("\n");
}
