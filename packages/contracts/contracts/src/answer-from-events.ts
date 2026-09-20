/**
 * @file answer-from-events
 * @description Extracts a judgeable final answer from an ArenaEvent stream.
 *
 * Responsibilities:
 * - Mirror arena-view thought->observation priority and banner skip; truncation (first 2k vs last 4k) and turn scoping intentionally differ
 * - Keep the judge-side extraction dependency-free (harness, agent, application,
 *   and evaluation all consume this contract-level projection)
 */

import type { ArenaEvent } from "./events.js";
import { isPipelineConfigBanner } from "./pipeline-banner.js";

/** Prefers the last thought sequence; falls back to the last observation. */
export function extractAnswerFromEvents(events: ArenaEvent[]): string {
  let lastThought = "";
  let streaming = "";
  let lastObs = "";
  for (const event of events) {
    if (event.type === "thought") {
      if (isPipelineConfigBanner(event.content)) continue;
      streaming = event.content ?? "";
      lastThought = streaming;
    } else if (event.type === "thought_delta") {
      const chunk = event.content ?? "";
      if (!chunk) continue;
      if (!streaming && isPipelineConfigBanner(chunk)) continue;
      streaming += chunk;
      lastThought = streaming;
    } else if (event.type === "thought_end") {
      lastThought = event.content ? event.content : streaming;
      streaming = "";
    } else if (event.type === "observation") {
      lastObs = event.result ?? "";
    }
  }
  return (lastThought || lastObs).slice(0, 2000).trim();
}

/** Counts tool action events in a stream (used as the judge's tool_calls signal). */
export function countActionEvents(events: ArenaEvent[]): number {
  return events.filter((event) => event.type === "action").length;
}
