/**
 * @file enums
 * @description Shared enums and single-source constants for the Arena domain.
 *
 * Responsibilities:
 * - Define dimension ids, thinking levels, prompt profiles, reasoning modes
 * - Define context strategies, harness levels, toolsets, MCP/skill/orchestration policies, and API formats
 */

import { z } from "zod";

/** Arena comparison dimension id. Adding a dimension only requires extending this enum and the dimension definition modules. */
export const DimensionIdSchema = z.enum([
  "framework",
  "prompt",
  "reasoning",
  "context",
  "harness",
  "temperature",
  "model",
  "thinking",
  "max_steps",
  "toolset",
  "mcp",
  "skill",
  "orchestration",
  "memory",
]);
export type DimensionId = z.infer<typeof DimensionIdSchema>;

/** Model thinking effort levels. */
export const ThinkingLevelSchema = z.enum(["off", "low", "medium", "high"]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

/** Prompt template profiles. */
export const PromptProfileSchema = z.enum(["zero_shot", "few_shot", "cot_prompt", "structured", "terse"]);
export type PromptProfile = z.infer<typeof PromptProfileSchema>;

/** Reasoning modes (control-flow strategies). */
export const ReasoningModeSchema = z.enum(["react", "cot_tool", "tot", "reflexion", "self_consistency"]);
export type ReasoningMode = z.infer<typeof ReasoningModeSchema>;

/** Context assembly strategies. */
export const ContextStrategySchema = z.enum(["sliding", "summary", "vector", "hybrid", "tool_tail", "token_budget", "budget", "checkpoint"]);
export type ContextStrategy = z.infer<typeof ContextStrategySchema>;

/** Harness capability levels (verification / reflection / self-evolution loops). */
export const HarnessLevelSchema = z.enum(["bare", "verify", "reflect", "self_evolve"]);
export type HarnessLevel = z.infer<typeof HarnessLevelSchema>;

/** Toolset ids (each selects the subset of tools bound to the model). */
export const ToolsetIdSchema = z.enum(["full", "edit_run", "read_only"]);
export type ToolsetId = z.infer<typeof ToolsetIdSchema>;

/** MCP attachment policy: which out-of-process capability servers are bridged into the tool list. */
export const McpPolicySchema = z.enum(["off", "fs", "full"]);
export type McpPolicy = z.infer<typeof McpPolicySchema>;

/** Skill loading policy: whether runbooks stay on-demand, are preloaded into the prompt, or are disabled. */
export const SkillPolicySchema = z.enum(["off", "on_demand", "preloaded"]);
export type SkillPolicy = z.infer<typeof SkillPolicySchema>;

/** Orchestration policy: direct execution vs plan-first vs goal-first discipline. */
export const OrchestrationModeSchema = z.enum(["direct", "plan_first", "goal_first"]);
export type OrchestrationMode = z.infer<typeof OrchestrationModeSchema>;

/** Memory recall policy: which cross-session memory layers mount into the prompt. */
export const MemoryPolicySchema = z.enum(["none", "episodic", "semantic", "full"]);
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

/** How unattended runs approve tool calls: auto denies only catastrophic shell shapes; unless_trusted additionally requires known-safe shell commands. */
export const ApprovalModeSchema = z.enum(["auto", "unless_trusted"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

/** OS-level execution containment for spawned shell children: off keeps analysis+approval only; os adds the write-restricted sandbox (Windows). */
export const SandboxModeSchema = z.enum(["off", "os"]);
export type SandboxMode = z.infer<typeof SandboxModeSchema>;

/** Tool names bound to each toolset (system-wide single source of truth: tool definitions, guards, and mode descriptions derive from this). */
export const TOOL_NAMES_BY_TOOLSET: Record<ToolsetId, readonly string[]> = {
  full: ["read", "write", "edit", "ls", "bash", "apply_patch", "glob", "grep", "webfetch", "todo_write", "ask_user", "web_search", "run_job", "bash_session", "subagent", "skill", "goal", "ralph_loop", "plan", "session_query", "symbols", "scatter"],
  edit_run: ["read", "write", "edit", "bash", "apply_patch", "glob", "grep", "todo_write", "ask_user", "run_job", "bash_session", "subagent", "skill", "goal", "ralph_loop", "plan", "session_query", "symbols", "scatter"],
  read_only: ["read", "ls", "glob", "grep", "subagent", "skill", "ralph_loop", "session_query", "symbols", "scatter"],
};

/** LLM API wire formats. */
export const ApiFormatSchema = z.enum(["anthropic_messages", "openai_chat", "openai_responses"]);
export type ApiFormat = z.infer<typeof ApiFormatSchema>;
