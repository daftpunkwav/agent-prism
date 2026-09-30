/**
 * @file chatEntry
 * @description Chat entry shape shared by the chat panel and the trace helpers.
 *
 * Responsibilities:
 * - Define the ChatEntry shape rendered by the chat bubbles and trace helpers
 *
 * Owned here (not in ChatPanel) so pure display modules can type against it
 * without importing a React component.
 */

import type { DisplaySegment } from "@agentprism/arena-view";

/**
 * One chat entry: server history carries role/content only; the client attaches
 * the turn's display segments so the bubble keeps its thinking/steps collapsed
 * after the run settles (instead of vanishing with the live view).
 */
export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  segments?: DisplaySegment[];
}
