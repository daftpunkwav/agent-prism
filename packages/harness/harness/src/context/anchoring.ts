/**
 * @file anchoring
 * @description Task anchoring: keeps the agent on-task without extra user turns.
 *
 * Responsibilities:
 * - Write the unique task into the first system message
 * - Append grounding reminders to tool results
 */

import type { LlmMessage } from "@agentprism/contracts";
import { textFromContent } from "./message-text.js";

/** Extracts the first non-anchored user message as the original question. */
export function extractOriginalQuestion(messages: LlmMessage[]): string {
  for (const message of messages) {
    if (message.role === "user") {
      const text = textFromContent(message.content).trim();
      if (text.startsWith("[Task anchor]")) continue;
      return text;
    }
  }
  return "";
}

/** Before every call, writes the unique task into the first system message. */
export function reinforceSystemWithQuestion(messages: LlmMessage[], question: string): LlmMessage[] {
  if (messages.length === 0 || question.trim() === "") return [...messages];
  const out = [...messages];
  const anchor =
    `\n\n[Unique task] ${question.trim()}\n` +
    "Stop after completing this task. Do not start any new topic or new task.";
  const first = out[0];
  if (first !== undefined && first.role === "system") {
    const content = textFromContent(first.content);
    if (!content.includes("[Unique task]")) {
      out[0] = { role: "system", content: content + anchor };
    }
  }
  return out;
}

/** Appends the task anchor to tool-result text, avoiding an extra user turn. */
export function injectToolResultReminder(result: string, question: string): string {
  const q = question.trim() || "(unknown)";
  return (
    `${result}\n\n` +
    `—\n[Task anchor] User's original question: ${q}\n` +
    "If you can answer sufficiently, give the final answer and stop; do not start a new task."
  );
}

/** Task-anchoring entry: write into the first system message, never a trailing user turn. */
export function withToolGrounding(messages: LlmMessage[]): LlmMessage[] {
  const question = extractOriginalQuestion(messages);
  return reinforceSystemWithQuestion([...messages], question);
}
