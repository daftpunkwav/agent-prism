/**
 * @file crew
 * @description CrewAI-style crew primitives: roles, tasks, process selection.
 *
 * Responsibilities:
 * - Define the researcher/coder/reviewer crew (role, goal, backstory)
 * - Provide the sequential task pipeline and the hierarchical manager protocol
 * - Read the ARENA_CREWAI_PROCESS knob (sequential default)
 *
 * Faithful-pattern implementation of CrewAI's crew/task/process model on the
 * arena's neutral ports; not vendor code.
 */

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

export function roleByKey(key: CrewRole["key"]): CrewRole {
  const role = CREW_ROLES.find((entry) => entry.key === key);
  if (role === undefined) throw new Error(`Unknown crew role "${key}"`);
  return role;
}

/** Builds the per-turn worker instruction (agent + task + expected_output). */
export function roleInstruction(role: CrewRole, task: string, expectedOutput: string): string {
  return `[CrewAI ${role.role}] Goal: ${role.goal}. ${role.backstory}\nTask: ${task}\nExpected output: ${expectedOutput}`;
}

export interface CrewTask {
  role: CrewRole["key"];
  task: string;
  expectedOutput: string;
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
      task: "The manager declared the crew done. Verify the work and produce the final answer.",
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
        : "Continue the crew task.",
      complete: false,
    };
  } catch {
    return null;
  }
}
