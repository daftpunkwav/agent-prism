#!/usr/bin/env node
/**
 * @file main
 * @description The executable host's entry point.
 *
 * Responsibilities:
 * - Assemble components, bind the server, and wait for signals
 */

import { assemble } from "./assemble.js";
import { installCrashHandlers, installSignalHandlers } from "./lifecycle.js";
import { startServer } from "./server.js";

/** How often the append-only session log is compacted into its snapshot. */
const SESSION_CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;

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
  // Periodic session-log compaction: the append-only log stays small without a
  // debounce cost per mutation. unref keeps the timer from holding the process
  // open; the shutdown path flushes and checkpoints explicitly.
  const checkpoint = setInterval(() => {
    void components?.checkpointStores().catch((error: unknown) => {
      console.warn(`[server] Session checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, SESSION_CHECKPOINT_INTERVAL_MS);
  checkpoint.unref?.();
  // Last-resort crash path: an uncaught exception or unhandled rejection still
  // exits non-zero, but saves the debounced-store tail first (bounded flush).
  installCrashHandlers(() => components?.flushDurableStores() ?? Promise.resolve());
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
        // Compact before the last flush: the log tail lands in the snapshot, so the
        // next boot replays a bounded log.
        await components?.checkpointStores().catch(() => undefined);
        await components?.flushDurableStores();
      }
    },
    { shutdownGraceMs: components.settings.serverShutdownGraceMs },
  );
}

void main();
