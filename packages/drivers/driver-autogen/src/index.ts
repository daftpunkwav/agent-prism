/**
 * @file driver-autogen package barrel
 * @description Public exports for the AutoGen-pattern driver package.
 *
 * Responsibilities:
 * - Re-export the driver and the group-chat primitives
 */

export { AutogenDriver, reviewerBudgetFor } from "./autogen-driver.js";
export {
  AUTOGEN_TERMINATE_KEYWORD,
  CODER_INSTRUCTION,
  REVIEWER_INSTRUCTION,
  isTerminationMessage,
  parseSpeakerSelection,
  speakerSelectionPrompt,
  type GroupChatSpeaker,
} from "./group-chat.js";
