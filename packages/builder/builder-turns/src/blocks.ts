/**
 * @file blocks
 * @description The block palette: framework, model, tool, and capability blocks.
 *
 * Responsibilities:
 * - Define capability block groups derived from the single-source option lists
 * - Assemble the full BuilderCatalog from injected availability sources
 *
 * Pure assembly only: availability comes from ports (drivers, endpoints, tools),
 * never from global lookups, so the palette always reflects the live registry.
 * Capability option lists derive from the contracts enums the composition
 * schema validates against; only per-value copy lives here.
 */

import type { ToolDefinition } from "@agentprism/contracts";
import {
  ContextStrategySchema,
  HarnessLevelSchema,
  McpPolicySchema,
  MemoryPolicySchema,
  OrchestrationModeSchema,
  PromptProfileSchema,
  REASONING_MODE_META,
  SkillPolicySchema,
  ThinkingLevelSchema,
  type BuilderCatalog,
  type BuilderCapabilityBlockId,
  type BuilderEndpointBlock,
  type BuilderToolBlock,
} from "@agentprism/contracts";

/** One selectable value of a capability block slot. */
export interface CapabilityOptionSpec {
  value: string;
  label: string;
  description: string;
}

/** Per-value English copy for options derived from the single-source lists. */
const DESCRIPTIONS: Record<string, string> = {
  sliding: "Keep the most recent messages within budget",
  summary: "Compress older history into a summary",
  vector: "Retrieve workspace snippets relevant to the question",
  hybrid: "Sliding window plus vector retrieval",
  tool_tail: "Keep reasoning, prune bulky tool results head+tail",
  token_budget: "Global char budget, stale tool results drop first",
  budget: "Per-source token allowances with a ledger",
  checkpoint: "Condense the oldest span into a checkpoint",
  bare: "No verification loop and no tool drift guard",
  verify: "Verify the answer after execution",
  reflect: "Execute, evaluate, reflect, and improve",
  self_evolve: "Reflect and propose prompt improvements",
  zero_shot: "Plain task instruction",
  few_shot: "Instruction with worked examples",
  cot_prompt: "Plan first, then act",
  structured: "Final reply restated as schema JSON",
  terse: "Minimal prose, tools first",
  off: "No extended thinking",
  low: "Brief extended thinking",
  medium: "Balanced extended thinking",
  high: "Deep extended thinking",
  none: "No cross-session memory",
  episodic: "Recall and write back past task post-mortems",
  semantic: "Recall project facts and conventions",
  full: "Episodic plus semantic memory",
  fs: "Bridge the workspace filesystem MCP tools",
  on_demand: "Skill tool loads runbooks on demand",
  preloaded: "Runbooks preloaded into the system prompt",
  direct: "Free-form execution",
  plan_first: "Seed a plan doc before coding",
  goal_first: "Seed a tracked objective before coding",
  auto: "Auto-approve non-catastrophic tool calls",
  unless_trusted: "Also require known-safe shell commands",
};

function describe(value: string): string {
  return DESCRIPTIONS[value] ?? "";
}

/** Derives labeled options from a contracts enum's values (labels localize in the UI). */
function fromEnum(schema: { options: readonly string[] }): CapabilityOptionSpec[] {
  return schema.options.map((value) => ({ value, label: value, description: describe(value) }));
}

/** Capability block slots, derived from the single-source option lists the Arena uses. */
export const CAPABILITY_GROUPS: ReadonlyArray<{
  block: BuilderCapabilityBlockId;
  options: readonly CapabilityOptionSpec[];
}> = [
  {
    block: "reasoning",
    options: REASONING_MODE_META.map((meta) => ({ value: meta.mode, label: meta.label, description: meta.description })),
  },
  {
    block: "context",
    options: fromEnum(ContextStrategySchema),
  },
  {
    block: "harness",
    options: fromEnum(HarnessLevelSchema),
  },
  {
    block: "prompt_profile",
    options: fromEnum(PromptProfileSchema),
  },
  {
    block: "thinking",
    options: fromEnum(ThinkingLevelSchema),
  },
  {
    block: "memory",
    options: fromEnum(MemoryPolicySchema),
  },
  {
    block: "mcp_policy",
    options: fromEnum(McpPolicySchema),
  },
  {
    block: "skill_policy",
    options: fromEnum(SkillPolicySchema),
  },
  {
    block: "orchestration",
    options: fromEnum(OrchestrationModeSchema),
  },
];

/** Availability sources the catalog assembles from (injected at the composition root). */
export interface BuilderCatalogSources {
  frameworks: () => Array<{ id: string; name: string; status: "available" | "reserved"; reason?: string }>;
  endpoints: () => BuilderEndpointBlock[];
  tools: () => readonly ToolDefinition[];
}

/** Assembles the block palette from live registries. */
export function buildBuilderCatalog(sources: BuilderCatalogSources): BuilderCatalog {
  const tools: BuilderToolBlock[] = sources
    .tools()
    .map((definition) => ({
      name: definition.name,
      description: definition.description,
      mutates_workspace: definition.mutatesWorkspace,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    frameworks: sources.frameworks().map((framework) => ({
      id: framework.id,
      name: framework.name,
      status: framework.status,
      reason: framework.reason ?? "",
    })),
    endpoints: sources.endpoints(),
    tools,
    capabilities: CAPABILITY_GROUPS.map((group) => ({
      block: group.block,
      options: group.options.map((option) => ({ ...option })),
    })),
  };
}
