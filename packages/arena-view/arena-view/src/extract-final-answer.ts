/**
 * @file extract-final-answer
 * @description Extracts a column's final answer from its event stream.
 *
 * Responsibilities:
 * - Prefer the last turn's assistant text (thought sequence)
 * - Fall back to the last observation when no assistant text exists
 *
 * Feeds judging and follow-up history; pure function over events.
 */

import type { ArenaEvent } from "@agentprism/contracts";
import { isPipelineConfigBanner } from "@agentprism/contracts";

/**
 * Extracts the "final answer" from a column's event stream (for judging / follow-up
 * history). Prefers the last turn's assistant text (thought sequence), falling back
 * to observation. All Step-0 config banners are excluded (own column and foreign
 * drift alike — isPipelineConfigBanner covers every registered prefix).
 */
export function extractFinalAnswer(events: ArenaEvent[], turn?: number): string {
  const target =
    turn != null
      ? turn
      : Math.max(0, ...events.map((e) => ("turn" in e ? (e.turn ?? 0) : 0)));

  let lastThought = "";
  let streamingThought = "";
  let lastObs = "";

  for (const ev of events) {
    const evTurn = "turn" in ev ? (ev.turn ?? 0) : 0;
    if (target > 0 && evTurn !== target) continue;

    if (ev.type === "thought") {
      if (isPipelineConfigBanner(ev.content)) {
        continue;
      }
      streamingThought = ev.content ?? "";
      lastThought = streamingThought;
    } else if (ev.type === "thought_delta") {
      const chunk = ev.content ?? "";
      if (!chunk) continue;
      if (!streamingThought && isPipelineConfigBanner(chunk)) {
        continue;
      }
      streamingThought += chunk;
      lastThought = streamingThought;
    } else if (ev.type === "thought_end") {
      if (ev.content) {
        lastThought = ev.content;
      } else if (streamingThought) {
        lastThought = streamingThought;
      }
      // An empty end (a tool-only round closes its sequence with no text) must
      // not erase the previous text sequence — the last spoken text still is
      // the column's final answer.
      streamingThought = "";
    } else if (ev.type === "observation") {
      lastObs = ev.result ?? "";
    }
  }

  return (lastThought || lastObs).slice(-4000).trim();
}
