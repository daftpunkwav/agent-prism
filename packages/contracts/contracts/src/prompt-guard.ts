/**
 * @file prompt-guard
 * @description Prompt-injection detection and LLM output cleaning.
 *
 * Responsibilities:
 * - Detect injection patterns in model output
 * - Sanitize prompt additions and JSON fences
 *
 * Pure functions, reused by the judgment chain and external consumers.
 */

import { textFromContent } from "./llm-message.js";

export const JSON_FENCE = /```(?:json|JSON)?\s*\n?(.*?)\n?\s*```/s;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /disregard\s+(?:the\s+)?system\s+prompt/i,
  /override\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?)/i,
  /new\s+instructions?\s*:/i,
  /you\s+are\s+now\s+/i,
  /<\|.*?\|>/,
  /\[INST\]|\[\/INST\]/i,
  // Chinese jailbreak/injection patterns (Unicode-escaped) for Chinese-user attacks.
  /\u5ffd\u7565\s*(?:\u4ee5\u4e0a|\u4e4b\u524d|\u5148\u524d)?\s*\u7684?\s*(?:\u6240\u6709)?\s*(?:\u6307\u4ee4|\u63d0\u793a|\u89c4\u5219)/,
  /\u8d8a\u72f1/,
];

const MAX_ADDITION_CHARS = 1000;

function replaceAllPatterns(text: string, replacement: string): string {
  let result = text;
  for (const pattern of INJECTION_PATTERNS) {
    // Force the global flag: without it only the first occurrence is filtered and a repeated payload survives.
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    result = result.replace(new RegExp(pattern.source, flags), () => replacement);
  }
  return result;
}

function stripJsonFence(text: string): string {
  const match = JSON_FENCE.exec(text);
  if (match?.[1] !== undefined) {
    return match[1].trim();
  }
  const cleaned = text.replace(/^```(?:json|JSON)?\s*$/gm, "");
  return cleaned.trim();
}

/** Sanitizes self-evolving prompt additions: NFKC → injection-pattern filtering → truncation. */
export function sanitizePromptAdditions(additions: unknown): string {
  if (!Array.isArray(additions) || additions.length === 0) return "";
  const cleaned: string[] = [];
  let total = 0;
  for (const raw of additions) {
    if (typeof raw !== "string") continue;
    let text = raw.normalize("NFKC").trim();
    if (text === "") continue;
    text = replaceAllPatterns(text, "[Filtered]").slice(0, 500);
    cleaned.push(text);
    total += text.length;
    if (total >= MAX_ADDITION_CHARS) break;
  }
  return cleaned.join(" ").slice(0, MAX_ADDITION_CHARS);
}

/** Extracts the JSON object section from model output and strips the fence. */
export function sanitizeForJson(content: unknown): string {
  const text = textFromContent(content);
  const match = /\{[\s\S]*\}/.exec(text);
  if (match !== null) {
    return stripJsonFence(match[0]);
  }
  return stripJsonFence(text);
}

/** Detects common prompt-injection patterns. */
export function detectInjection(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
