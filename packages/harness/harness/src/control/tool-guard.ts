/**
 * @file tool-guard
 * @description Tool-call relevance guard: heuristic, deliberately not exact.
 *
 * Responsibilities:
 * - Score calls with keyword plus character-overlap heuristics
 * - Block clearly off-topic calls
 *
 * On a false block the model receives the reason and self-corrects.
 */

import { TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import { injectToolResultReminder } from "../context/anchoring.js";
import { callDriftRejection, fileDriftRejection } from "../prompt/runtime-copy.js";

// Chinese hints kept via Unicode escapes so Chinese questions still match; English for parity.
const SUM_HINTS = [
  "\u7b49\u4e8e\u591a\u5c11", // equals how much
  "\u6c42\u548c", // sum
  "\u52a0\u5230", // add up to
  "\u8ba1\u7b97", // calculate
  "1+2",
  "sum",
  "how much",
  "add up",
  "calculate",
  "compute",
];
const FILE_HINTS = [
  "\u5199\u5165", // write
  "\u4fdd\u5b58", // save
  "\u6587\u4ef6", // file
  "\u521b\u5efa", // create
  "html",
  "fib",
  ".txt",
  ".html",
  "write",
  "save",
  "file",
  "create",
];
/** Tool names subject to drift checks (all toolset names except read/ls; includes read-only glob/grep as drift targets); the drift guard's check targets, derived from the contracts single source. */
const DRIFT_TOOL_NAMES = new Set(
  Object.values(TOOL_NAMES_BY_TOOLSET)
    .flat()
    .filter((name) => name !== "read" && name !== "ls"),
);

function norm(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/g, "");
}

function argsBlob(toolArgs: Record<string, unknown> | null): string {
  try {
    return JSON.stringify(toolArgs ?? {});
  } catch (error) {
    console.warn(`[harness] Failed to serialize tool args: ${error instanceof Error ? error.message : String(error)}`);
    return String(toolArgs);
  }
}

/** Coarse overlap: how many CJK 2-grams / alphanumeric chunks of the question appear in the args. */
function charOverlapRatio(question: string, blob: string): number {
  const q = norm(question);
  const b = norm(blob);
  if (q === "" || b === "") return 0.0;
  const grams = new Set<string>();
  for (let i = 0; i < q.length - 1; i += 1) {
    grams.add(q.slice(i, i + 2));
  }
  for (const match of q.matchAll(/[a-z0-9_]{3,}/g)) {
    grams.add(match[0]);
  }
  if (grams.size === 0) return 1.0;
  let hit = 0;
  for (const gram of grams) {
    if (b.includes(gram)) hit += 1;
  }
  return hit / grams.size;
}

export interface ToolRelevanceVerdict {
  allowed: boolean;
  reason: string;
}

/** Decides whether a tool call relates to the user question; on rejection the reason goes into the ToolMessage for the model to correct. */
export function assessToolRelevance(
  question: string,
  toolName: string,
  toolArgs: Record<string, unknown> | null,
  priorToolNames: readonly string[] = [],
): ToolRelevanceVerdict {
  const q = (question ?? "").trim();
  const args = toolArgs ?? {};
  const prior = priorToolNames;
  const blob = argsBlob(args);
  const lowerQ = q.toLowerCase();

  // Drift scoring needs a lexical anchor: a pure-CJK question cannot overlap
  // Latin code args, so the ratio would be ~0 for every call and the guard
  // would block all real work. Only assert drift when the question itself
  // carries enough Latin anchor tokens.
  const latinAnchors = q.match(/[a-z0-9_]{3,}/g) ?? [];
  const hasLatinAnchor = latinAnchors.length >= 3;

  // After prior tool results, a long DRIFT-tool call with low overlap with the question → treat as drift
  if (prior.length > 0 && hasLatinAnchor && DRIFT_TOOL_NAMES.has(toolName)) {
    const overlap = charOverlapRatio(q, `${toolName}${blob}`);
    const needsFile = FILE_HINTS.some((hint) => lowerQ.includes(hint.toLowerCase()));
    const needsCalc = SUM_HINTS.some((hint) => lowerQ.includes(hint.toLowerCase()));
    if (toolName === "bash" && needsCalc) {
      return { allowed: true, reason: "" };
    }
    if ((toolName === "write" || toolName === "edit") && needsFile) {
      if (blob.length > 80 && overlap < 0.05) {
        return { allowed: false, reason: fileDriftRejection(toolName, q) };
      }
      return { allowed: true, reason: "" };
    }
    if (overlap < 0.08 && blob.length > 20) {
      return { allowed: false, reason: callDriftRejection(toolName, q) };
    }
  }

  return { allowed: true, reason: "" };
}

/**
 * If the call should be blocked, returns the anchored block message; otherwise null.
 * `harness === "bare"` disables the guard entirely: the harness level is the
 * user-facing switch (Builder sessions and Arena unguarded columns run without
 * this heuristic).
 */
export function blockedToolMessageContent(
  question: string,
  toolName: string,
  toolArgs: Record<string, unknown> | null,
  priorToolNames: readonly string[] = [],
  harness?: string,
): string | null {
  if (harness === "bare") return null;
  const verdict = assessToolRelevance(question, toolName, toolArgs, priorToolNames);
  if (verdict.allowed) return null;
  return injectToolResultReminder(verdict.reason, question);
}
