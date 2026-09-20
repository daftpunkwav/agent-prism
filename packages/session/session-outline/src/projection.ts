/**
 * @file session-outline/projection
 * @description Pure-fold turn outlines over arena event streams.
 *
 * Responsibilities:
 * - Fold turn-segmented events into per-turn outline entries
 * - Cap prompt/response previews to rail budgets with ellipsis
 * - Summarize tool calls and terminal verdicts per turn
 *
 * Previews mirror the UI rail clamps (one prompt line, three response lines)
 * so a turn reads identically before and after its events load. Turn 0 is
 * the unset sentinel (turns are 1-based): unturned events collect under turn 0
 * instead of vanishing. Pure and total: any event list folds without throwing.
 */

import type { ArenaEvent } from "@agentprism/contracts";

/** Prompt preview budget: one rail-card line. */
export const PROMPT_PREVIEW_LIMIT = 60;

/** Response preview budget: three rail-card lines. */
export const RESPONSE_PREVIEW_LIMIT = 240;

/** One turn's outline entry. */
export interface TurnOutlineEntry {
  turn: number;
  /** First user prompt preview (null when the turn has none). */
  prompt: string | null;
  /** Latest assistant text preview (null when none). */
  response: string | null;
  /** Tool names called in first-use order. */
  tools: string[];
  /** Terminal verdict when the turn settled (null while open). */
  verdict: "completed" | "failed" | null;
  /** Event count folded into this turn. */
  events: number;
}

/** Collapses whitespace and caps at limit with a trailing ellipsis. */
function preview(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function eventText(event: ArenaEvent): string {
  if (event.type === "thought" || event.type === "thought_delta") return event.content ?? "";
  if (event.type === "observation") return event.result ?? "";
  if (event.type === "error") return event.message ?? "";
  return "";
}

/**
 * Folds events into per-turn outlines sorted by turn ascending.
 * Thoughts accumulate into the response draft; observations join it;
 * actions record tool names; complete/error settle the verdict.
 */
export function outlineTurns(events: readonly ArenaEvent[], prompts: Record<number, string> = {}): TurnOutlineEntry[] {
  const turns = new Map<number, { response: string; tools: string[]; verdict: TurnOutlineEntry["verdict"]; events: number }>();
  const entry = (turn: number): { response: string; tools: string[]; verdict: TurnOutlineEntry["verdict"]; events: number } => {
    let found = turns.get(turn);
    if (found === undefined) {
      found = { response: "", tools: [], verdict: null, events: 0 };
      turns.set(turn, found);
    }
    return found;
  };
  for (const event of events) {
    const turn = typeof event.turn === "number" && Number.isFinite(event.turn) && event.turn > 0 ? Math.floor(event.turn) : 0;
    const state = entry(turn);
    state.events += 1;
    if (event.type === "thought" || event.type === "thought_delta") {
      const text = eventText(event);
      if (text !== "") state.response = state.response === "" ? text : `${state.response} ${text}`;
    } else if (event.type === "observation") {
      const text = eventText(event);
      if (text !== "" && state.response === "") state.response = text;
    } else if (event.type === "action") {
      const tool = typeof event.tool === "string" ? event.tool : "";
      if (tool !== "" && !state.tools.includes(tool)) state.tools.push(tool);
    } else if (event.type === "complete") {
      state.verdict = event.metrics?.success === true ? "completed" : "failed";
    } else if (event.type === "error") {
      state.verdict = "failed";
      if (state.response === "") state.response = eventText(event);
    }
  }
  // Prompt preview comes from the host-supplied turn prompts (user turns are
  // history, not events): previewed to the rail budget, null when unknown.
  return [...turns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, state]) => {
      const raw = prompts[turn];
      const prompt = typeof raw === "string" && raw.trim() !== "" ? preview(raw, PROMPT_PREVIEW_LIMIT) : null;
      return {
        turn,
        prompt,
        response: state.response === "" ? null : preview(state.response, RESPONSE_PREVIEW_LIMIT),
        tools: state.tools,
        verdict: state.verdict,
        events: state.events,
      };
    });
}

/** One-line outline digest per turn for logs (stable order). */
export function outlineDigest(entries: readonly TurnOutlineEntry[]): string[] {
  return entries.map((entry) => {
    const verdict = entry.verdict ?? "open";
    const tools = entry.tools.length === 0 ? "-" : entry.tools.join(",");
    return `turn ${entry.turn}: ${verdict} tools=[${tools}] events=${entry.events}`;
  });
}

export { PROMPT_PREVIEW_LIMIT as PROMPT_PREVIEW_CHARS };
