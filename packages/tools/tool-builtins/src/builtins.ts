/**
 * @file builtins
 * @description Registers the twenty-two builtin workspace tools into a fresh registry.
 *
 * Responsibilities:
 * - Build a registry preloaded with the twenty-two builtin workspace tools
 * - Derive workspace-mutation info from the registered set
 */

import type { ToolRegistry } from "@agentprism/contracts";
import { applyPatchTool } from "./definitions/apply-patch.js";
import { editTool } from "./definitions/edit.js";
import { globTool } from "./definitions/glob.js";
import { grepTool } from "./definitions/grep.js";
import { lsTool } from "./definitions/ls.js";
import { readTool } from "./definitions/read.js";
import { bashTool } from "./definitions/bash.js";
import { todoTool } from "./definitions/todo.js";
import { askUserTool } from "./definitions/ask-user.js";
import { webSearchTool } from "./definitions/web-search.js";
import { runJobTool } from "./definitions/run-job.js";
import { bashSessionTool } from "./definitions/bash-session.js";
import { subagentPlaceholderTool } from "./definitions/subagent.js";
import { skillTool } from "./definitions/skill.js";
import { goalTool } from "./definitions/goal.js";
import { ralphPlaceholderTool } from "./definitions/ralph.js";
import { planTool } from "./definitions/plan.js";
import { sessionQueryPlaceholderTool } from "./definitions/session-query.js";
import { symbolsTool } from "@agentprism/tool-symbols";
import { scatterPlaceholderTool } from "./definitions/scatter.js";
import { webFetchTool } from "./definitions/web-fetch.js";
import { writeTool } from "./definitions/write.js";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { setToolTuning, type ToolTuning } from "./tuning.js";

const BUILTIN_TOOLS = [readTool, writeTool, editTool, lsTool, bashTool, applyPatchTool, globTool, grepTool, webFetchTool, todoTool, askUserTool, webSearchTool, runJobTool, bashSessionTool, subagentPlaceholderTool, skillTool, goalTool, ralphPlaceholderTool, planTool, sessionQueryPlaceholderTool, symbolsTool, scatterPlaceholderTool] as const;

/**
 * Creates a registry with all builtin workspace tools registered. The optional
 * tuning applies operator overrides (caps/timeouts) composition-time; definitions
 * read tuned values at execute time, so registration order never freezes them.
 */
export function createBuiltinToolRegistry(tuning: ToolTuning = {}): ToolRegistry {
  setToolTuning(tuning);
  const registry = new MapToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
  return registry;
}

