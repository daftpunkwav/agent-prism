/**
 * @file fields
 * @description Dimension field metadata tables for the Arena UI.
 *
 * Responsibilities:
 * - Provide field/label/subtitle/name tables and UI grouping
 * - Declare baseline-only decode options and their labels
 * - Expose current-endpoint suffix helpers
 *
 * Labels here are the English canonical fallback; product locales overlay
 * via web i18n.
 */

/** Dimension id → PipelineConfig field name: contract single source (contracts/dimension-field); re-exported here to keep the package's export surface stable. */
export { DIMENSION_FIELD } from "@agentprism/contracts";

/** Dimension option triple: overridden field name + option value + display label. */
export interface DimensionOptionTriple {
  field: string;
  value: string;
  label: string;
}

/** Decode control-variable options that are baseline-only, not comparison dimensions (value, label). Levels must match the contracts/decode-options.ts single source. */
export const BASELINE_ONLY_OPTIONS: Record<string, Array<[string, string]>> = {
  approval_mode: [
    ["auto", "Auto (deny catastrophic commands only)"],
    ["unless_trusted", "Known-safe commands only"],
  ],
  sandbox_mode: [
    ["off", "Off (analysis and approval only)"],
    ["os", "OS write sandbox (workspace-only writes)"],
  ],
  top_p: [
    ["0.5", "0.5"],
    ["0.8", "0.8"],
    ["0.9", "0.9"],
    ["1", "1.0"],
  ],
  frequency_penalty: [
    ["0", "0"],
    ["0.5", "0.5"],
    ["1", "1.0"],
  ],
  presence_penalty: [
    ["0", "0"],
    ["0.5", "0.5"],
    ["1", "1.0"],
  ],
  max_output_tokens: [
    ["512", "512"],
    ["1024", "1024"],
    ["2048", "2048"],
    ["4096", "4096"],
    ["8192", "8192"],
    ["96000", "96000"],
  ],
};

export const BASELINE_ONLY_LABELS: Record<string, string> = {
  approval_mode: "Approval mode",
  sandbox_mode: "Sandbox mode",
  top_p: "Top P",
  frequency_penalty: "Frequency Penalty",
  presence_penalty: "Presence Penalty",
  max_output_tokens: "Max output tokens",
};

/** Dimension id → display name (English canonical). */
export const FIELD_LABELS: Record<string, string> = {
  framework: "Framework",
  prompt: "Prompt",
  reasoning: "Reasoning",
  context: "Context",
  harness: "Harness",
  temperature: "Temperature",
  model: "Model",
  thinking: "Thinking",
  thinking_budget: "Thinking budget",
  max_steps: "Max steps",
  toolset: "Toolset",
  mcp: "MCP",
  skill: "Skill",
  orchestration: "Orchestration",
  memory: "Memory",
  history_mode: "History",
};

/** Dimension id → purpose description (subtitle of the dimension card in the Arena UI). */
export const FIELD_SUBTITLES: Record<string, string> = {
  framework: "Orchestration differs; other dims stay pinned by the baseline",
  prompt: "Switches only the Prompt template; other dims stay pinned by the baseline",
  reasoning: "Control-flow modes (react/cot/tot/reflexion/self-consistency); each column has its own disk workspace",
  context: "Sliding / summary / vector / hybrid / tool-tail / token-budget actually trim before every LLM call",
  harness: "Dimension columns pin Native: three drivers share VerificationPolicy (verify/reflect/self_evolve truly retry)",
  temperature: "Writes the real LLM temperature (sampling randomness)",
  model: "Switches Settings endpoints (cross-provider or multi-model on one connection); decode params stay pinned",
  thinking: "off/low/medium/high; the model must have \"supports thinking\" checked in Settings to enable",
  max_steps: "All frameworks but LangChain enforce the turn budget; LangChain only approximates it via recursion_limit",
  thinking_budget: "Anthropic budget_tokens (0 = follow the level); numeric overrides the level mapping",
  toolset: "Really filters bind_tools / create_agent tool lists",
  mcp: "Bridges MCP filesystem/fetch servers into the tool list; off vs fs vs full changes what the model can call",
  skill: "Off disables the skill tool, on-demand loads via skill tool, preloaded injects runbooks into the prompt",
  orchestration: "Direct runs free-form; plan-first seeds a plan doc, goal-first seeds a tracked objective",
  memory: "Mounts cross-session memory into the prompt; none vs episodic vs semantic vs full changes what the model recalls",
  history_mode: "Cross-turn replay: minimal bare Q/A vs one-line tool summary vs full args + results appended to past answers",
};

/** Config field name → display name (used by presentation layers such as reports and narratives). */
export const FIELD_NAME_LABELS: Record<string, string> = {
  framework: "Framework",
  prompt_profile: "Prompt",
  reasoning: "Reasoning",
  context: "Context",
  harness: "Harness",
  temperature: "Temperature",
  endpoint_id: "Model",
  thinking_level: "Thinking",
  thinking_budget: "Thinking budget",
  max_steps: "Max steps",
  toolset: "Toolset",
  mcp_policy: "MCP",
  skill_policy: "Skill",
  orchestration: "Orchestration",
  memory: "Memory",
  history_mode: "History",
};

/** Baseline UI grouping (pipeline / decode / access). */
export const FIELD_GROUP: Record<string, string> = {
  framework: "pipeline",
  prompt_profile: "pipeline",
  reasoning: "pipeline",
  context: "pipeline",
  harness: "pipeline",
  toolset: "pipeline",
  max_steps: "pipeline",
  mcp_policy: "pipeline",
  skill_policy: "pipeline",
  approval_mode: "pipeline",
  sandbox_mode: "pipeline",
  orchestration: "pipeline",
  memory: "pipeline",
  history_mode: "pipeline",
  temperature: "decode",
  top_p: "decode",
  frequency_penalty: "decode",
  presence_penalty: "decode",
  max_output_tokens: "decode",
  thinking_level: "decode",
  thinking_budget: "decode",
  endpoint_id: "access",
  model_id: "access",
};

/** English canonical suffix for the default endpoint label (UI locales overlay this). */
export const CURRENT_ENDPOINT_SUFFIX = " (current)";

/** Display convention for the default endpoint: the default entry's label gets a "current" suffix (shared by static fallback and runtime projection). */
export function currentEndpointLabel(label: string): string {
  return `${label}${CURRENT_ENDPOINT_SUFFIX}`;
}
