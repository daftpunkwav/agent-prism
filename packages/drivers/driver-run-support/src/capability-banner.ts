/**
 * @file capability-banner
 * @description Formats the capability ids of a run for Step-0 config banners.
 *
 * Responsibilities:
 * - Render prompt/reasoning/context/harness/toolset ids plus the policy switches
 *   so a column run is reproducible from the trace alone
 */

import type { PipelineConfig } from "@agentprism/contracts";

/** Compact capability-id suffix for driver opening banners (emitted under the `plugins=` key). */
export function formatCapabilityPluginIds(config: PipelineConfig): string {
  const policy = config as Record<string, unknown>;
  return (
    `plugins=prompt:${config.prompt_profile};reason:${config.reasoning};` +
    `context:${config.context};verify:${config.harness};toolset:${config.toolset};` +
    `mcp:${String(policy["mcp_policy"] ?? "off")};skill:${String(policy["skill_policy"] ?? "on_demand")};` +
    `orchestration:${String(policy["orchestration"] ?? "direct")}`
  );
}
