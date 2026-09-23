/**
 * @file history-mode
 * @description Cross-turn history modes: capture tool activity from event streams
 * and render it back into replayed history at the execution boundary.
 *
 * Responsibilities:
 * - Define ToolRound (one captured action→observation pair) and its char caps
 * - Extract tool rounds from an ArenaEvent stream (deterministic, no LLM)
 * - Render history entries per HistoryMode (minimal keeps byte-identical behavior)
 *
 * Capture always stores the full superset (tool_rounds); rendering trims per the
 * column's history_mode, so the mode can change between turns without losing data.
 * Rounds render as assistant-text appendices, never as structured tool messages:
 * past turns' tools cannot be re-called, and text keeps the wire's strict
 * user/assistant alternation intact.
 */

import { z } from "zod";
import type { ArenaEvent } from "./events.js";
import type { HistoryMode } from "./enums.js";

/** One captured tool invocation: the action's tool+args and the paired observation result.
 * Over-sized args (serialized above TOOL_ROUND_ARGS_MAX_CHARS) collapse to a
 * `{ preview }` record at capture, mirroring the result cap: replay renders at
 * most the preview anyway, and unbounded args would bust the wire budget.
 */
export const ToolRoundSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  result: z.string(),
});
export type ToolRound = z.infer<typeof ToolRoundSchema>;

/** Char cap for one round's serialized args (event args are structured; keep the capture bounded). */
export const TOOL_ROUND_ARGS_MAX_CHARS = 2_000;

/** Char cap for the whole rendered tool-activity appendix on one history entry. */
export const TOOL_ACTIVITY_MAX_CHARS = 32_000;

/** JSON.stringify with insertion order kept, dropping undefined values the way events carry them. */
function stableArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args) ?? "{}";
  } catch {
    return "{}";
  }
}

/** Truncates with an explicit ellipsis marker so a cut is visible, not silent. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Keeps args as captured when they serialize within the cap; otherwise collapses to a bounded preview record. */
function boundedArgs(args: Record<string, unknown>): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(args) ?? "";
  } catch {
    return { preview: "" };
  }
  if (text.length <= TOOL_ROUND_ARGS_MAX_CHARS) return args;
  return { preview: text.slice(0, TOOL_ROUND_ARGS_MAX_CHARS) };
}

/**
 * Extracts tool rounds from an ArenaEvent stream by pairing each `action`
 * with the next `observation` on the same pipeline column. Column-aware so
 * interleaved multi-column streams never mispair. Deterministic and
 * dependency-free so threads, builder sessions, and the arena client can all
 * capture from the same stream they already consume.
 */
export function extractToolRounds(events: ArenaEvent[]): ToolRound[] {
  const rounds: ToolRound[] = [];
  let pending: { pipeline: string; tool: string; args: Record<string, unknown> } | null = null;
  for (const event of events) {
    if (event.type === "action") {
      pending = { pipeline: event.pipeline, tool: event.tool, args: event.args };
      continue;
    }
    if (event.type === "observation" && pending !== null && pending.pipeline === event.pipeline) {
      rounds.push({
        tool: pending.tool,
        args: boundedArgs(pending.args),
        result: truncate(event.result ?? "", 8_000),
      });
      pending = null;
    }
  }
  return rounds;
}

/**
 * Renders one tool-activity appendix for a history entry.
 * `tool_summary`: one line per round — `tool(args) → result-head`.
 * `full`: args and result in fenced blocks, up to the char caps.
 * Returns "" for minimal or when there is nothing to render (fail-closed to
 * the plain answer, so a round-less entry is byte-identical to the old shape).
 */
export function renderToolActivity(rounds: ToolRound[] | undefined, mode: HistoryMode): string {
  if (mode === "minimal" || rounds === undefined || rounds.length === 0) return "";
  const lines: string[] = [];
  let budget = TOOL_ACTIVITY_MAX_CHARS;
  for (const round of rounds) {
    const argsText = truncate(stableArgs(round.args), TOOL_ROUND_ARGS_MAX_CHARS);
    let line: string;
    if (mode === "tool_summary") {
      const resultHead = truncate(round.result.replace(/\s+/g, " ").trim(), 200);
      line = `- ${round.tool}(${argsText}) → ${resultHead}`;
    } else {
      line = `- ${round.tool}\n  args: ${argsText}\n  result: ${truncate(round.result, 8_000)}`;
    }
    // Always keep the first round; stop before a line that would blow the budget.
    if (lines.length > 0 && budget - (line.length + 1) < 0) {
      lines.push("- …(older tool activity truncated)");
      break;
    }
    lines.push(line);
    budget -= line.length + 1;
  }
  return `\n\n[Tool activity from this turn]\n${lines.join("\n")}`;
}
