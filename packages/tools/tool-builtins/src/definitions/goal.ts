/**
 * @file tools/goal
 * @description Builtin goal tool: one durable session objective with a status lifecycle.
 *
 * Responsibilities:
 * - Persist the workspace objective plus done criteria to .agent-goal.json
 * - Move it through active/paused/blocked/completed (blocked demands a reason)
 * - Render the standing objective for plans, handoffs, and wrap-ups
 *
 * Localized DSH goal domain (without the cordis service, /goal command plane,
 * and round-driver): todo_write tracks steps, this tracks the objective those
 * steps serve — including the two states todos lack (paused, blocked). One goal
 * per workspace; setting a new one replaces the old (whole-object replacement,
 * same honesty rule as todo_write).
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const GOAL_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "get the goal, set (replace) it, change status, or clear it" },
    objective: { type: "string", description: "The session objective (set only)" },
    criteria: {
      type: "array",
      description: "Done criteria checked at completion (set only)",
      items: { type: "string" },
    },
    status: { type: "string", description: "active, paused, blocked, or completed (status only)" },
    detail: { type: "string", description: "Block reason or completion note (status only)" },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Storage file inside the workspace root (dotfile: stays out of the model's way). */
export const GOAL_STORE_FILE = ".agent-goal.json";

const ACTIONS = ["get", "set", "status", "clear"] as const;
const STATUSES = ["active", "paused", "blocked", "completed"] as const;
type GoalStatus = (typeof STATUSES)[number];

const MAX_OBJECTIVE_CHARS = 1000;
const MAX_CRITERIA = 20;
const MAX_CRITERION_CHARS = 200;
const MAX_DETAIL_CHARS = 1000;

interface Goal {
  objective: string;
  criteria: string[];
  status: GoalStatus;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reads the stored goal; corrupt or missing storage means no goal (never throws into a run). */
function readGoal(readFile: (path: string) => string): Goal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(GOAL_STORE_FILE));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.objective !== "string" || parsed.objective === "") return null;
  if (typeof parsed.status !== "string" || !(STATUSES as readonly string[]).includes(parsed.status)) return null;
  const criteria = Array.isArray(parsed.criteria)
    ? parsed.criteria.filter((item): item is string => typeof item === "string")
    : [];
  return {
    objective: parsed.objective,
    criteria,
    status: parsed.status as GoalStatus,
    detail: typeof parsed.detail === "string" ? parsed.detail : "",
  };
}

function render(goal: Goal): string {
  const lines = [`# Goal [${goal.status}]`, "", goal.objective];
  if (goal.criteria.length > 0) {
    lines.push("", "Done criteria:");
    for (const criterion of goal.criteria) lines.push(`- ${criterion}`);
  }
  if (goal.detail !== "") lines.push("", goal.detail);
  return lines.join("\n");
}

async function executeGoal(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    // Action names are case-tolerant (LIST/Get/...) so a cased call still binds instead of error-looping.
    const action = String(args.action ?? "").trim().toLowerCase();
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { result: `Error: action must be one of ${ACTIONS.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (action === "get") {
      const goal = readGoal((filePath) => view.fs.readFile(filePath));
      if (goal === null) return { result: "(no goal set)", fileDiff: null, ok: true };
      return { result: boundText(workspace, "goal", render(goal)), fileDiff: null, ok: true };
    }
    if (action === "clear") {
      // Idempotent: clearing an absent goal still succeeds (no goal is the goal).
      try {
        view.fs.deleteFile(GOAL_STORE_FILE);
      } catch (error) {
        if (!(error instanceof WorkspaceError) || view.fs.exists(GOAL_STORE_FILE)) throw error;
      }
      return { result: "(goal cleared)", fileDiff: null, ok: true };
    }
    if (action === "set") {
      const objective = typeof args.objective === "string" ? args.objective.trim() : "";
      if (objective === "" || objective.length > MAX_OBJECTIVE_CHARS) {
        return { result: `Error: objective must be 1-${MAX_OBJECTIVE_CHARS} chars`, fileDiff: null, ok: false, code: "workspace_error" };
      }
      let criteria: string[] = [];
      if (args.criteria !== undefined) {
        if (!Array.isArray(args.criteria) || args.criteria.length > MAX_CRITERIA) {
          return { result: `Error: criteria must be an array of at most ${MAX_CRITERIA} items`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        criteria = (args.criteria as unknown[]).map((item) => (typeof item === "string" ? item.trim() : ""));
        if (criteria.some((item) => item === "" || item.length > MAX_CRITERION_CHARS)) {
          return { result: `Error: every criterion must be 1-${MAX_CRITERION_CHARS} chars`, fileDiff: null, ok: false, code: "workspace_error" };
        }
      }
      const goal: Goal = { objective, criteria, status: "active", detail: "" };
      view.fs.writeFile(GOAL_STORE_FILE, `${JSON.stringify(goal, null, 2)}\n`);
      return { result: boundText(workspace, "goal", render(goal)), fileDiff: null, ok: true };
    }
    const current = readGoal((filePath) => view.fs.readFile(filePath));
    if (current === null) {
      return { result: "Error: no goal set (set one first)", fileDiff: null, ok: false, code: "workspace_error" };
    }
    // Status is case-tolerant so a cased call still binds instead of error-looping.
    const status = String(args.status ?? "").trim().toLowerCase();
    if (!(STATUSES as readonly string[]).includes(status)) {
      return { result: `Error: status must be one of ${STATUSES.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const detail = typeof args.detail === "string" ? args.detail.trim().slice(0, MAX_DETAIL_CHARS) : "";
    // A blocked goal without a reason is unactionable for the next turn: demand it.
    if (status === "blocked" && detail === "") {
      return { result: "Error: blocking a goal requires detail (what blocks, what unblocks)", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const updated: Goal = { ...current, status: status as GoalStatus, detail };
    view.fs.writeFile(GOAL_STORE_FILE, `${JSON.stringify(updated, null, 2)}\n`);
    return { result: boundText(workspace, "goal", render(updated)), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin goal tool definition. */
export const goalTool: ToolDefinition = {
  name: "goal",
  description:
    "Track the one session objective: set it with done criteria, move it through active/paused/blocked/completed, get it for handoffs. Blocking demands a reason. Complements todo_write (steps) with the objective those steps serve.",
  jsonSchema: GOAL_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeGoal,
};
