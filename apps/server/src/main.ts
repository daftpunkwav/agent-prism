#!/usr/bin/env node
/**
 * @file main
 * @description The executable host's entry point.
 *
 * Responsibilities:
 * - Assemble components, bind the server, and wait for signals
 */

import { assemble } from "./assemble.js";
import { installSignalHandlers } from "./lifecycle.js";
import { startServer } from "./server.js";

/** Executable host entry: assemble → listen → wait for signals. */
async function main(): Promise<void> {
  let stop: (() => Promise<void>) | null = null;
  let components: Awaited<ReturnType<typeof assemble>> | null = null;
  try {
    components = await assemble();
    stop = await startServer(components);
  } catch (error) {
    console.error(`[server] Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
    return;
  }
  installSignalHandlers(
    async () => {
      // Flush before and after draining: a turn that commits while stop() waits
      // for connections would otherwise be lost to the process exit (its own
      // flush is fire-and-forget, and the exit kills the debounce timer).
      // The second flush runs in a finally so a stop() failure cannot drop it.
      await components?.flushDurableStores();
      try {
        await stop?.();
      } finally {
        await components?.flushDurableStores();
      }
    },
    { shutdownGraceMs: components.settings.serverShutdownGraceMs },
  );
}

void main();
