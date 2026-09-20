/**
 * @file builtin-registration
 * @description Best-effort driver registration over injected loaders.
 *
 * Responsibilities:
 * - Register each loaded driver; one loader failure never blocks the rest
 *
 * Loaders are injected (never imported) so this seam package stays free of
 * backend dependencies; the composition root supplies the builtin loader list.
 */

import type { AgentDriver } from "@agentprism/contracts";
import type { FrameworkDriverRegistry } from "./registry.js";

/** Named lazy driver supplier; load must construct (not run) the driver. */
export interface DriverLoader {
  name: string;
  load: () => Promise<AgentDriver>;
}

/**
 * Registers every supplied driver: a single loader failure is warned and
 * skipped so one broken backend cannot take down the whole runtime.
 */
export async function registerDriversBestEffort(
  registry: FrameworkDriverRegistry,
  loaders: readonly DriverLoader[],
): Promise<void> {
  for (const loader of loaders) {
    try {
      registry.register(await loader.load());
    } catch (error) {
      console.warn(
        `[driver-registry] ${loader.name} driver registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
