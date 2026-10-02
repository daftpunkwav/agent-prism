/**
 * @file structured-output
 * @description Single-source schema for constrained final answers.
 *
 * Responsibilities:
 * - Define the JSON Schema the structured prompt profile enforces on the final reply
 * - Expose the LlmResponseFormat consumed by the provider adapter
 *
 * The schema field names are mirrored by the structured profile text in the
 * harness prompt sections; both sides must stay in sync with this constant.
 */

import { textFromContent } from "./llm-message.js";

/** Schema-constrained output request for a single LLM call. */
export interface LlmResponseFormat {
  /** Schema name surfaced to the provider (forced tool name on the Anthropic wire). */
  name: string;
  /** JSON Schema object the reply must satisfy. */
  schema: Record<string, unknown>;
}

/** Required keys of the structured final answer (prompt text mirrors these). */
export const STRUCTURED_FINAL_KEYS = ["plan", "files", "how_to_run"] as const;

/**
 * JSON Schema for the structured profile's final reply. Flat object with every
 * key required and additionalProperties disabled, so it also satisfies strict
 * mode on wires that enforce it (OpenAI json_schema). `files` items are bare
 * strings because strict json_schema cannot express minItems/non-empty items —
 * parseStructuredFinalAnswer enforces the stricter shape after the fact.
 */
export const FINAL_ANSWER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    plan: { type: "string", description: "What was done, in one short paragraph" },
    files: {
      type: "array",
      items: { type: "string" },
      description: "Artifact paths produced or modified",
    },
    how_to_run: { type: "string", description: "How to run or verify the artifacts" },
  },
  required: [...STRUCTURED_FINAL_KEYS],
  additionalProperties: false,
};

/** Response format enforcing the structured final answer on capable wires. */
export const FINAL_ANSWER_RESPONSE_FORMAT: LlmResponseFormat = {
  name: "final_answer",
  schema: FINAL_ANSWER_JSON_SCHEMA,
};

/**
 * Extracts the substring from the first `{` to the last `}` as a JSON.parse
 * candidate (null when no such span exists). indexOf keeps the scan linear:
 * the regex form `/\{[\s\S]*\}/` restarts from every `{` when the text has no
 * closing brace, degrading quadratically on hostile model output.
 */
export function jsonObjectCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

/**
 * Extracts and validates a structured final answer from raw model output.
 * Returns the canonical JSON string when every required key is present with a
 * usable value; null otherwise (caller keeps the raw answer, fail-open).
 */
export function parseStructuredFinalAnswer(raw: unknown): string | null {
  const text = textFromContent(raw);
  const candidate = jsonObjectCandidate(text);
  if (candidate === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  for (const key of STRUCTURED_FINAL_KEYS) {
    const value = record[key];
    if (key === "files") {
      // Stricter than the wire schema on purpose (strict json_schema cannot
      // express non-empty items): an empty-string entry rejects the payload
      // and the caller keeps the raw answer (fail-open).
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
        return null;
      }
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") return null;
  }
  return JSON.stringify(record);
}
