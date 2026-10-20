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

/** Incremental answer extraction: push events as they stream, read the answer at any point. */
export interface AnswerProjection {
  /** Folds one event into the projection; events of other types are ignored. */
  push(event: ArenaEvent): void;
  /** Last thought sequence with banner skip, falling back to the last observation. */
  answer(): string;
}

/**
 * Single source of the answer-extraction state machine. Streaming consumers
 * (e.g. the agent execution finalize) push events as they pass through; the
 * batch extractAnswerFromEvents is a plain fold over the same machine, so the
 * two readers can never drift. `answer()` applies no truncation or trimming:
 * truncation is a reader-side policy (the judge slices to 2k, the finalize
 * normalizes the raw text).
 */
export function createAnswerProjection(): AnswerProjection {
  let lastThought = "";
  let streaming = "";
  let lastObs = "";
  return {
    push(event: ArenaEvent): void {
      if (event.type === "thought") {
        if (isPipelineConfigBanner(event.content)) return;
        streaming = event.content ?? "";
        lastThought = streaming;
      } else if (event.type === "thought_delta") {
        const chunk = event.content ?? "";
        if (!chunk) return;
        if (!streaming && isPipelineConfigBanner(chunk)) return;
        streaming += chunk;
        lastThought = streaming;
      } else if (event.type === "thought_end") {
        // A tool-only round closes its sequence with no text: an empty end must
        // not erase the previous text sequence — the last spoken text still is
        // the answer (mirrors arena-view extractFinalAnswer and its pinned test).
        if (event.content) {
          lastThought = event.content;
        } else if (streaming !== "") {
          lastThought = streaming;
        }
        streaming = "";
      } else if (event.type === "observation") {
        lastObs = event.result ?? "";
      }
    },
    answer: () => (lastThought || lastObs),
  };
}

/** Prefers the last thought sequence; falls back to the last observation. */
export function extractAnswerFromEvents(events: ArenaEvent[]): string {
  const projection = createAnswerProjection();
  for (const event of events) projection.push(event);
  return projection.answer().slice(0, 2000).trim();
}

/** Counts tool action events in a stream (used as the judge's tool_calls signal). */
export function countActionEvents(events: ArenaEvent[]): number {
  return events.filter((event) => event.type === "action").length;
}
