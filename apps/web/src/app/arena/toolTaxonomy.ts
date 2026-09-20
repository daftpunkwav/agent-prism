/**
 * @file toolTaxonomy
 * @description Tool-name classification for trace renderers: maps one tool name to one display category.
 *
 * Responsibilities:
 * - Classify tool names into read/write/code/ask/plan/net/agent/other
 * - Keep interactive (ask_user), planning, network, and agent tools out of the file-op categories
 *
 * Pure lookup tables: callers pass pre-lowercased tool names.
 */

/** Tool categories: file reads vs writes vs code exec vs interactive/planning/network/agent. ask_user/todo_write/webfetch and friends must never render as file ops. */
export type ToolCategory = "read" | "write" | "code" | "ask" | "plan" | "net" | "agent" | "other";

const READ_TOOLS: ReadonlySet<string> = new Set(["read", "ls", "glob", "grep", "symbols"]);
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "apply_patch"]);
const CODE_TOOLS: ReadonlySet<string> = new Set(["run", "run_job", "bash_session"]);
const PLAN_TOOLS: ReadonlySet<string> = new Set(["todo_write", "plan", "goal", "ralph_loop"]);
const NET_TOOLS: ReadonlySet<string> = new Set(["webfetch", "web_search"]);
const AGENT_TOOLS: ReadonlySet<string> = new Set(["subagent", "skill", "session_query", "scatter"]);

/** Classifies one pre-lowercased tool name into its display category. */
export function toolCategory(toolLower: string): ToolCategory {
  if (READ_TOOLS.has(toolLower)) return "read";
  if (WRITE_TOOLS.has(toolLower)) return "write";
  if (CODE_TOOLS.has(toolLower)) return "code";
  if (toolLower === "ask_user") return "ask";
  if (PLAN_TOOLS.has(toolLower)) return "plan";
  if (NET_TOOLS.has(toolLower)) return "net";
  if (AGENT_TOOLS.has(toolLower)) return "agent";
  return "other";
}
