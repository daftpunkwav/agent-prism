/**
 * @file group-chat
 * @description AutoGen-style group chat primitives: speakers, selection parsing, termination.
 *
 * Responsibilities:
 * - Define the coder/reviewer participant model (the user proxy executes tools, no LLM)
 * - Parse LLM speaker-selection replies and reviewer termination messages
 * - Provide the per-speaker role instructions and selection prompt
 *
 * Faithful-pattern implementation of AutoGen's group chat (LLM speaker
 * selection, TERMINATE keyword termination) on the arena's neutral ports;
 * not vendor code.
 */

/** LLM participants of the group chat (the user proxy is the tool executor, not an LLM). */
export type GroupChatSpeaker = "coder" | "reviewer";

/** AutoGen's conventional termination keyword (is_termination_msg analog). */
export const AUTOGEN_TERMINATE_KEYWORD = "TERMINATE";

/** Coder role instruction (AssistantAgent system_message analog). */
export const CODER_INSTRUCTION =
  "[AutoGen coder] You are the coding assistant. Make progress with tool calls; " +
  "when the task is complete, reply with the final answer stating artifact paths and how to run them.";

/** Reviewer role instruction (critic conversable agent analog). */
export const REVIEWER_INSTRUCTION =
  "[AutoGen reviewer] Review the transcript. If the task is complete, start your reply with TERMINATE and add a one-line verdict. " +
  "Otherwise give the single most important next step.";

/** Builds the speaker-selection note appended to the transcript (manager "auto" mode). */
export function speakerSelectionPrompt(lastSpeaker: GroupChatSpeaker | null): string {
  const last = lastSpeaker === null ? "none (chat start)" : lastSpeaker;
  return `[AutoGen group chat] Who speaks next: "coder" or "reviewer"? Last speaker: ${last}. Reply with just the name.`;
}

/** Parses a speaker-selection reply; anything unrecognized falls back to the coder. */
export function parseSpeakerSelection(text: string): GroupChatSpeaker {
  return /reviewer/i.test(text) ? "reviewer" : "coder";
}

/** True when a reviewer message terminates the chat. */
export function isTerminationMessage(text: string): boolean {
  return text.includes(AUTOGEN_TERMINATE_KEYWORD);
}
