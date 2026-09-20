/**
 * @file tool-tail
 * @description Tool-result-aware context strategy: per-tool head+tail pruning.
 *
 * Responsibilities:
 * - Keep full reasoning text; shrink oversized tool results in place
 * - Preserve tool-call/result pairing while trimming the window
 *
 * Rationale: model reasoning and user turns are usually short and information
 * dense; tool outputs (build logs, test runs, directory listings) are long and
 * front-loaded with boilerplate while conclusions and errors land at the tail.
 * Unlike sliding (which drops whole old messages) or summary (which rewrites
 * them), tool_tail keeps every turn and only compacts the bulky tool payloads,
 * so the error tail that decides the next action is never the first thing cut.
 */

import type { LlmMessage } from "@agentprism/contracts";
import { messageText } from "./message-text.js";

/** Default per-result budget (chars) before pruning kicks in. */
export const TOOL_TAIL_BUDGET = 4000;

/** Tail share kept verbatim (conclusions/errors); the rest is head. */
export const TOOL_TAIL_KEEP = 1200;

/** Tools whose output is a listing: keep the head (names), prune the tail. */
const HEAD_FIRST_TOOLS = new Set(["ls", "glob", "mcp__fs_list"]);

/** Prunes one tool result to head+tail with a marker; short results pass through. */
export function pruneToolResult(
  content: string,
  toolName: string,
  budget: number = TOOL_TAIL_BUDGET,
  keep: number = TOOL_TAIL_KEEP,
): string {
  if (content.length <= budget) return content;
  const tail = Math.min(keep, Math.floor(budget / 4));
  const marker = `\n…[tool_tail pruned ${toolName}: ${content.length} chars]…\n`;
  const head = budget - tail - marker.length;
  if (head <= 0) return `${content.slice(0, budget)}\n…(truncated)`;
  if (HEAD_FIRST_TOOLS.has(toolName)) {
    // Listings: the head carries the names; the tail is usually pagination noise.
    return `${content.slice(0, head + tail)}${marker.replace("tool_tail pruned", "tool_tail head-kept")}`;
  }
  return `${content.slice(0, head)}${marker}${content.slice(content.length - tail)}`;
}

/** Trims to the most recent window, expanding to keep tool pairs intact. */
function trimWindow(messages: LlmMessage[], windowSize: number): LlmMessage[] {
  if (messages.length <= windowSize) return [...messages];
  let start = messages.length - windowSize;
  while (start > 0 && messages[start]?.role === "tool") start -= 1;
  const trimmed = messages.slice(start);
  const firstOwned = trimmed.findIndex((message) => message.role !== "tool");
  return firstOwned === -1 ? [] : trimmed.slice(firstOwned);
}

export interface ToolTailOptions {
  windowSize?: number;
  budget?: number;
  /** Tail chars kept verbatim (default TOOL_TAIL_KEEP). */
  keep?: number;
}

/**
 * Applies the tool_tail strategy: leading system messages pinned, window
 * trimmed with pair preservation, every tool result pruned in place.
 * Never mutates the input.
 */
export function applyToolTail(messages: LlmMessage[], options: ToolTailOptions = {}): LlmMessage[] {
  if (messages.length === 0) return [];
  const windowSize = options.windowSize ?? 12;
  const budget = options.budget ?? TOOL_TAIL_BUDGET;
  const keep = options.keep ?? TOOL_TAIL_KEEP;
  const systems: LlmMessage[] = [];
  const rest: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "system" && rest.length === 0) systems.push(message);
    else rest.push(message);
  }
  return [
    ...systems,
    ...trimWindow(rest, windowSize).map((message) => {
      if (message.role !== "tool") return message;
      const text = messageText(message);
      const pruned = pruneToolResult(text, message.name ?? "tool", budget, keep);
      return pruned === text ? message : { ...message, content: pruned };
    }),
  ];
}
