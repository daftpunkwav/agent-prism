/**
 * @file prompt/phase-blocks
 * @description Shared verbatim prompt blocks reused by multiple drivers' phase prompts.
 *
 * Responsibilities:
 * - Own the atomic sentences that appear byte-identical in more than one driver
 *   (ToT propose / score reply protocol) so wording changes land in one place
 * - Export string constants only: no composition, no logic — drivers embed them
 *   into their own phase-prompt templates from their per-package prompts file
 */

/** ToT propose atom, byte-identical in driver-native and driver-langgraph. */
export const PROPOSE_ONE_APPROACH = "Propose ONE distinct solution approach (at most 4 steps). Do not call tools.";

/** ToT score reply atom: the SCORE protocol line shared by both ToT implementations. */
export const SCORE_REPLY_PROTOCOL = 'Reply with "SCORE: <0-10>" then one line of reasoning.';
