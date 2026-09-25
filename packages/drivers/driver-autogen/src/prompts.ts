/**
 * @file prompts
 * @description AutoGen driver's model-facing copy: role instructions and the
 *              speaker-selection prompt (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the coder/reviewer role instructions (AssistantAgent system_message analogs)
 * - Own the speaker-selection note and the termination keyword
 *
 * Termination note: AUTOGEN_TERMINATE_KEYWORD is both the protocol keyword the
 * driver matches replies against and a literal embedded in the reviewer
 * instruction — renaming it changes both the wire contract and the prompt.
 */

import type { GroupChatSpeaker } from "./group-chat.js";

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
