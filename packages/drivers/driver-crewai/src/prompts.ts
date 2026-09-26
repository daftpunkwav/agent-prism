/**
 * @file prompts
 * @description CrewAI driver's model-facing copy: crew roles, task pipeline, manager
 *              protocol, and transcript notes (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the researcher/coder/reviewer crew definitions (role, goal, backstory)
 * - Own the sequential task pipeline copy and the hierarchical manager instruction
 * - Own the transcript-note templates and fallback task copy used by the driver
 *
 * Types come from crew via type-only imports (no runtime cycle); crew
 * re-exports the copy symbols so existing imports keep resolving.
 *
 * Cross-language mirror: python/bootstrap.py embeds CREW_ROLES and the
 * sequential task copy verbatim — keep the two languages in sync.
 */

import type { CrewRole, CrewTask } from "./crew.js";

/** The crew (CrewAI agents: role + goal + backstory). */
export const CREW_ROLES: readonly CrewRole[] = [
  {
    key: "researcher",
    role: "Researcher",
    goal: "Gather the context the task needs",
    backstory: "A meticulous reader who summarizes what exists before anything changes.",
  },
  {
    key: "coder",
    role: "Coding Engineer",
    goal: "Implement the task with real tool calls",
    backstory: "A pragmatic engineer who edits files and verifies by running them.",
  },
  {
    key: "reviewer",
    role: "Quality Reviewer",
    goal: "Verify the work and summarize the final answer",
    backstory: "A skeptical reviewer who checks the result and states artifacts and how to run them.",
  },
];

/** Builds the per-turn worker instruction (agent + task + expected_output). */
export function roleInstruction(role: CrewRole, task: string, expectedOutput: string): string {
  return `[CrewAI ${role.role}] Goal: ${role.goal}. ${role.backstory}\nTask: ${task}\nExpected output: ${expectedOutput}`;
}

/** Sequential process pipeline: research → implement → verify and summarize. */
export const SEQUENTIAL_TASKS: readonly CrewTask[] = [
  {
    role: "researcher",
    task: "Investigate the workspace and gather what the task needs.",
    expectedOutput: "A short brief: relevant files, constraints, and the plan.",
  },
  {
    role: "coder",
    task: "Implement the task end to end.",
    expectedOutput: "Working artifacts for the task.",
  },
  {
    role: "reviewer",
    task: "Verify the artifacts and produce the final answer.",
    expectedOutput: "The final answer: what was done, artifact paths, how to run them.",
  },
];

/** Manager keyword that ends a hierarchical crew (manager declares completion). */
export const CREW_COMPLETE_KEYWORD = "CREW_COMPLETE";

/** Manager system instruction for the hierarchical process. */
export const MANAGER_INSTRUCTION =
  "[CrewAI manager] Delegate one crew member at a time. Reply with exactly one JSON object " +
  '{"role":"researcher"|"coder"|"reviewer","task":"..."} — or reply CREW_COMPLETE when the crew is done.';

/** Task for the completing reviewer pass after CREW_COMPLETE (also the parse fallback). */
export const MANAGER_DONE_TASK =
  "The manager declared the crew done. Verify the work and produce the final answer.";

/** Task for an unparsable manager reply that stays in the hierarchy. */
export const MANAGER_FALLBACK_TASK = "Continue the crew task.";

/** Closing reviewer pass expected output (shared by completion and final-answer passes). */
export const CREW_VERIFY_EXPECTED = "What was done, artifact paths, how to run them.";

/** Closing reviewer pass task before the crew ends without the manager's completion. */
export const CREW_FINAL_TASK = "Produce the crew's final answer.";

/** Expected output for delegated mid-hierarchy tasks. */
export const CREW_PROGRESS_EXPECTED = "Progress toward the crew goal.";

/** Tool-round continuation note appended after tool results. */
export const TOOL_RESULTS_CONTINUE_NOTE = "[CrewAI] Continue from the tool results above.";

/** User-note template mounting one worker's task output into the transcript. */
export function taskOutputNote(role: string, output: string): string {
  return `[CrewAI] ${role} task output:\n${output}`;
}

/** User-note template mounting one worker's report into the transcript. */
export function workerReportsNote(role: string, text: string): string {
  return `[CrewAI] ${role} reports:\n${text}`;
}
