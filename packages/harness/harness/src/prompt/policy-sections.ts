/**
 * @file policy-sections
 * @description Prompt notes for MCP, skill, and orchestration policies.
 *
 * Responsibilities:
 * - Render fail-closed policy lines for mcp/skill/orchestration selections
 * - Keep bodies generic (skill runbook text arrives via the execution context)
 *
 * Unknown policy tokens fail closed to the documented defaults (off/direct/on_demand
 * handling lives with the callers); these helpers only render known tokens.
 */

/** MCP attachment note (empty when off or unknown). */
export function mcpPolicyNote(policy: string | null | undefined): string {
  if (policy === "fs") {
    return "\n\n[MCP: filesystem server attached (mcp__fs_list, mcp__fs_read). Prefer MCP tools for workspace reads when they suffice.]";
  }
  if (policy === "full") {
    return "\n\n[MCP: filesystem + fetch servers attached (mcp__fs_list, mcp__fs_read, mcp__fetch_url). Prefer MCP tools when they suffice; builtins remain available.]";
  }
  return "";
}

/** Skill policy note (empty for on_demand; off and preloaded change model behavior). */
export function skillPolicyNote(policy: string | null | undefined): string {
  if (policy === "off") {
    return "\n\n[Skills disabled for this run: do not call the skill tool; work from the base prompt only.]";
  }
  if (policy === "preloaded") {
    return "\n\n[Skills preloaded below: runbooks are already in context; do not re-read them via the skill tool unless you need a workspace override.]";
  }
  return "";
}

/** Orchestration discipline note (empty for direct). */
export function orchestrationNote(mode: string | null | undefined): string {
  if (mode === "plan_first") {
    return "\n\n[Discipline: plan-first. Call the plan tool (propose) before editing code, then execute the recorded plan.]";
  }
  if (mode === "goal_first") {
    return "\n\n[Discipline: goal-first. Call the goal tool (set) with the objective and done criteria first, then execute toward it.]";
  }
  return "";
}
