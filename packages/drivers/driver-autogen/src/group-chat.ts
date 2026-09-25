/**
 * @file group-chat
 * @description AutoGen-style group chat primitives: speakers, selection parsing, termination.
 *
 * Responsibilities:
 * - Define the coder/reviewer participant model (the user proxy executes tools, no LLM)
 * - Parse LLM speaker-selection replies and reviewer termination messages
 * - Re-export the role instructions and selection prompt from prompts (single copy source)
 *
 * Faithful-pattern implementation of AutoGen's group chat (LLM speaker
 * selection, TERMINATE keyword termination) on the arena's neutral ports;
 * not vendor code.
 */

import {
  AUTOGEN_TERMINATE_KEYWORD,
  CODER_INSTRUCTION,
  REVIEWER_INSTRUCTION,
  speakerSelectionPrompt,
} from "./prompts.js";

export { AUTOGEN_TERMINATE_KEYWORD, CODER_INSTRUCTION, REVIEWER_INSTRUCTION, speakerSelectionPrompt };

/** LLM participants of the group chat (the user proxy is the tool executor, not an LLM). */
export type GroupChatSpeaker = "coder" | "reviewer";

/** Parses a speaker-selection reply; anything unrecognized falls back to the coder. */
export function parseSpeakerSelection(text: string): GroupChatSpeaker {
  return /reviewer/i.test(text) ? "reviewer" : "coder";
}

/** True when a reviewer message terminates the chat. */
export function isTerminationMessage(text: string): boolean {
  return text.includes(AUTOGEN_TERMINATE_KEYWORD);
}
