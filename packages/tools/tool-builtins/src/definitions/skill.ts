/**
 * @file tools/skill
 * @description Builtin skill tool: list and load skill runbooks on demand.
 *
 * Responsibilities:
 * - List bundled plus workspace skills (workspace overrides same-named bundled)
 * - Return full skill bodies for the exact names from the list
 *
 * Localized DSH tool-skill (loader half only): no session catalog injection, no
 * script execution — the model lists first, then loads before acting on matching
 * tasks. Read-only: safe in every toolset.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";
import {
  SKILL_FILE,
  SKILL_NAME_RE,
  parseSkillFile,
  type Skill,
} from "./skills.js";
import { effectiveSkills } from "./user-skills.js";

export const SKILL_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "list available skills, or read one skill body" },
    name: { type: "string", description: "Exact skill name from the list (read only)" },
  },
  required: ["action"],
  additionalProperties: false,
};

const ACTIONS = ["list", "read"] as const;

/**
 * Merges bundled, user-directory, and workspace `.skills/<name>/SKILL.md` files
 * into the effective catalog (workspace wins; disabled names filter out).
 */
function discoverSkills(readFile: (path: string) => string, listFiles: (dir: string) => string[]): { skills: Skill[]; skipped: number } {
  return effectiveSkills(readFile, listFiles);
}

async function executeSkill(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    // Action names are case-tolerant (LIST/Read/...) so a cased call still binds instead of error-looping.
    const action = String(args.action ?? "").trim().toLowerCase();
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { result: `Error: action must be one of ${ACTIONS.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const { skills, skipped } = discoverSkills(
      (filePath) => view.fs.readFile(filePath),
      (dir) => view.fs.listFiles(dir, { recursive: true }),
    );
    if (action === "list") {
      if (skills.length === 0) return { result: "(no skills available)", fileDiff: null, ok: true };
      const lines = skills.map((skill) => `- ${skill.name}: ${skill.description} [${skill.source}]`);
      const tail = skipped > 0 ? `\n(${skipped} invalid workspace skill(s) skipped)` : "";
      return { result: boundText(workspace, "skill", `Available skills (load with action=read before matching tasks):\n${lines.join("\n")}${tail}`), fileDiff: null, ok: true };
    }
    const name = String(args.name ?? "").trim();
    if (!SKILL_NAME_RE.test(name)) {
      return { result: "Error: name must be a kebab-case skill name from the list", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const skill = skills.find((item) => item.name === name);
    if (skill === undefined) {
      return { result: `Error: unknown skill ${JSON.stringify(name)} (list to see available skills)`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    return { result: boundText(workspace, "skill", `# ${skill.name} [${skill.source}]\n\n${skill.body}`), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin skill tool definition. */
export const skillTool: ToolDefinition = {
  name: "skill",
  description:
    "Load expert runbooks on demand: list available skills, then read one before acting on a matching task (e.g. commit conventions, pre-flight review). Workspace skills override bundled ones.",
  jsonSchema: SKILL_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeSkill,
};
