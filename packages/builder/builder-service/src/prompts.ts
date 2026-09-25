/**
 * @file prompts
 * @description Builder service's model-facing copy: session-compaction handoff
 *              prompt (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the compact handoff system instruction and the transcript wrapper
 */

/** System instruction for the compaction call: a structured handoff note. */
export const COMPACT_HANDOFF_SYSTEM =
  "Summarize this coding-agent conversation into a compact handoff note (aim under 2000 words). " +
  "Preserve: the active goal, key decisions and why, files created or modified with paths, " +
  "test and verification status, open questions and blockers. " +
  "Drop greetings, dead ends, and verbatim tool output. Reply with the note only.";
