/**
 * @file tools/plan
 * @description Builtin plan tool: draft and record the approach before acting.
 *
 * Responsibilities:
 * - Persist a freeform approach document to .agent-plan.md (propose/read/clear)
 * - Validate the document starts with a # heading (DSH plan discipline)
 *
 * Localized DSH plan-mode minus the approval half: there is no human reviewer
 * in this runtime, so propose records the plan and instructs the model to carry
 * it out (instead of presenting it for approval that can never come). The durable
 * half — write it down first, keep it in the workspace, reviewable post-hoc —
 * is fully real. Complements goal (objective) and todo_write (steps) with the
 * sequenced narrative linking them.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "propose (write/replace) the plan, read it back, or clear it" },
    plan: { type: "string", description: "Complete plan markdown for propose (must start with a # heading)" },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Storage file inside the workspace root (dotfile: stays out of the model's way). */
export const PLAN_STORE_FILE = ".agent-plan.md";

const ACTIONS = ["propose", "read", "clear"] as const;

/** Plan size budget (a plan is a handoff note, not a transcript dump). */
const MAX_PLAN_CHARS = 8000;

/** First markdown heading (any level): the plan must open with a named plan. */
function firstHeading(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match !== null) return match[1];
  }
  return undefined;
}

async function executePlan(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    // Action names are case-tolerant so a cased call still binds instead of error-looping.
    const action = String(args.action ?? "").trim().toLowerCase();
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { result: `Error: action must be one of ${ACTIONS.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (action === "read") {
      let text: string;
      try {
        text = view.fs.readFile(PLAN_STORE_FILE);
      } catch {
        return { result: "(no plan recorded)", fileDiff: null, ok: true };
      }
      return { result: boundText(workspace, "plan", text), fileDiff: null, ok: true };
    }
    if (action === "clear") {
      try {
        view.fs.deleteFile(PLAN_STORE_FILE);
      } catch (error) {
        if (!(error instanceof WorkspaceError) || view.fs.exists(PLAN_STORE_FILE)) throw error;
      }
      return { result: "(plan cleared)", fileDiff: null, ok: true };
    }
    const plan = typeof args.plan === "string" ? args.plan.trim() : "";
    if (plan === "") {
      return { result: "Error: plan must be a non-empty markdown document", fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (plan.length > MAX_PLAN_CHARS) {
      return { result: `Error: plan exceeds ${MAX_PLAN_CHARS} chars (write the approach, not the transcript)`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const heading = firstHeading(plan);
    if (heading === undefined) {
      return { result: "Error: plan must start with a # heading naming it", fileDiff: null, ok: false, code: "workspace_error" };
    }
    view.fs.writeFile(PLAN_STORE_FILE, `${plan}\n`);
    return {
      result: boundText(
        workspace,
        "plan",
        `Plan "${heading}" recorded (no human reviewer in this runtime: carry it out, revising via propose as facts change).`,
      ),
      fileDiff: null,
      ok: true,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin plan tool definition. */
export const planTool: ToolDefinition = {
  name: "plan",
  description:
    "Draft the approach before acting on multi-step work: propose the complete plan as markdown (must open with a # heading), read it back, or clear it. Recorded to the workspace for operator review.",
  jsonSchema: PLAN_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executePlan,
};
