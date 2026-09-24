/**
 * @file dimensions package barrel
 * @description Public exports for the dimensions package.
 *
 * Responsibilities:
 * - Re-export the catalog, field metadata, and a subset of per-dimension option tables (context/harness/prompt/reasoning/toolset)
 */

export * from "./dimension-catalog.js";
export * from "./fields.js";
export { CONTEXT_OPTIONS } from "./dimensions/context.js";
export { THINKING_BUDGET_OPTIONS, THINKING_OPTIONS } from "./dimensions/thinking.js";
export { HARNESS_OPTIONS } from "./dimensions/harness.js";
export { PROMPT_OPTIONS } from "./dimensions/prompt.js";
export { REASONING_OPTIONS } from "./dimensions/reasoning.js";
export { TOOLSET_OPTIONS } from "./dimensions/toolset.js";
export { MCP_OPTIONS } from "./dimensions/mcp.js";
export { SKILL_POLICY_OPTIONS } from "./dimensions/skill.js";
export { ORCHESTRATION_OPTIONS } from "./dimensions/orchestration.js";
export { MEMORY_OPTIONS } from "./dimensions/memory.js";
export { HISTORY_MODE_OPTIONS } from "./dimensions/history-mode.js";
