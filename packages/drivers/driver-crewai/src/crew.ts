/**
 * @file crew
 * @description CrewAI-style crew primitives: roles, tasks, process selection.
 *
 * Responsibilities:
 * - Define the crew role/task types and the process knob (ARENA_CREWAI_PROCESS)
 * - Parse the manager's delegation replies into assignments
 * - Re-export the crew copy (roles, pipeline, manager protocol) from prompts
 *
 * Faithful-pattern implementation of CrewAI's crew/task/process model on the
 * arena's neutral ports; not vendor code.
 */

import {
  CREW_COMPLETE_KEYWORD,
  CREW_ROLES,
  MANAGER_DONE_TASK,
  MANAGER_FALLBACK_TASK,
} from "./prompts.js";

export {
  CREW_COMPLETE_KEYWORD,
  CREW_ROLES,
  MANAGER_INSTRUCTION,
  SEQUENTIAL_TASKS,
  roleInstruction,
} from "./prompts.js";

/** Crew process: fixed task pipeline vs manager delegation per round. */
export type CrewProcess = "sequential" | "hierarchical";

/** Reads ARENA_CREWAI_PROCESS; anything but "hierarchical" keeps the sequential default. */
export function crewProcess(env: NodeJS.ProcessEnv = process.env): CrewProcess {
  return env["ARENA_CREWAI_PROCESS"] === "hierarchical" ? "hierarchical" : "sequential";
}

export interface CrewRole {
  key: "researcher" | "coder" | "reviewer";
  role: string;
  goal: string;
  backstory: string;
}

export function roleByKey(key: CrewRole["key"]): CrewRole {
  const role = CREW_ROLES.find((entry) => entry.key === key);
  if (role === undefined) throw new Error(`Unknown crew role "${key}"`);
  return role;
}

export interface CrewTask {
  role: CrewRole["key"];
  task: string;
  expectedOutput: string;
}

export interface ManagerAssignment {
  role: CrewRole["key"];
  task: string;
  complete: boolean;
}

/**
 * Parses the manager's delegation reply. CREW_COMPLETE maps to a completing
 * reviewer pass; unparsable replies return null (caller falls back).
 */
export function parseManagerAssignment(text: string): ManagerAssignment | null {
  if (text.includes(CREW_COMPLETE_KEYWORD)) {
    return {
      role: "reviewer",
      task: MANAGER_DONE_TASK,
      complete: true,
    };
  }
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const role = typeof parsed["role"] === "string" ? parsed["role"] : "";
    if (role !== "researcher" && role !== "coder" && role !== "reviewer") return null;
    return {
      role,
      task: typeof parsed["task"] === "string" && parsed["task"].trim() !== ""
        ? parsed["task"].slice(0, 500)
        : MANAGER_FALLBACK_TASK,
      complete: false,
    };
  } catch {
    return null;
  }
}
