/**
 * @file tools/caps
 * @description Bounded-output primitives for workspace tool handlers.
 *
 * Responsibilities:
 * - Cap output and file sizes
 * - Parse integer args and truncate tool results
 */

import { estimateTokensFromChars } from "@agentprism/contracts";

export const MAX_OUTPUT = 32 * 1024;
export const MAX_FILE = 256 * 1024;

/**
 * Caps text with middle-span pruning (keeps the head and tail, drops the middle).
 *
 * Oversized output keeps its head AND its tail with a marker between them:
 * command output usually concludes at the end (exit status, errors, summaries),
 * so a head-only cut hides exactly what the model needs. Model-free and
 * deterministic: the same input always yields the same output.
 */
export function truncate(text: string, maxLength: number = MAX_OUTPUT): string {
  if (text.length <= maxLength) return text;
  // Tail budget keeps roughly one quarter of the head's size: enough for
  // conclusions and error tails without starving the head.
  const tailChars = Math.max(0, Math.min(4096, Math.floor(maxLength / 5)));
  const marker = `\n…[middle pruned: ~${estimateTokensFromChars(text.length)} tokens total]…\n`;
  const headChars = maxLength - tailChars - marker.length;
  if (headChars <= 0) {
    // Degenerate budget (smaller than marker + tail): head-only cut, still loud.
    return `${text.slice(0, Math.max(0, maxLength))}\n…(truncated)`;
  }
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`;
}

/** Reads a truncated integer arg; absent (undefined/null/blank) and non-finite values fall back. */
export function readInt(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  // Blank strings are "not provided" from model args (Number("") is 0, which callers would mistake for an explicit zero).
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}
