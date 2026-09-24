/**
 * @file strategy-plugins
 * @description Module-level registry of externally contributed context strategies.
 *
 * Responsibilities:
 * - Hold ContextStrategyPlugin instances registered at the composition root
 * - Serve the capability option projection (listing) and the live pipeline
 *   dispatch (lookup) from the same map, so a registered id is always both
 *   selectable and runnable
 */

import type { ContextStrategyPlugin } from "@agentprism/contracts";

/** Registered plugins in insertion order; registration is idempotent per id. */
const externalPlugins = new Map<string, ContextStrategyPlugin>();

/** Registers externally contributed context strategies (custom-dimension subpackages). */
export function registerContextStrategyPlugins(plugins: readonly ContextStrategyPlugin[]): void {
  for (const plugin of plugins) externalPlugins.set(plugin.id, plugin);
}

/** Lists the registered plugins (capability option projection). */
export function listContextStrategyPlugins(): ContextStrategyPlugin[] {
  return [...externalPlugins.values()];
}

/** Returns the registered plugin with the given id, or undefined. */
export function contextStrategyPlugin(id: string): ContextStrategyPlugin | undefined {
  return externalPlugins.get(id);
}
