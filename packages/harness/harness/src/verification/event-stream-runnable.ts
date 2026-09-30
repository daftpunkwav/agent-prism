/**
 * @file event-stream-runnable
 * @description Transitional typing for streamables exposing streamEvents.
 *
 * Responsibilities:
 * - Type the minimal async-iterable surface LangGraph reasoning graphs hand
 *   back after compile().withConfig
 *
 * The legacy HarnessRunner class is removed; verification wraps driver.run
 * via runVerificationLoop in the agent package (see loop.ts).
 */

/** @deprecated Prefer graph.streamEvents directly; kept for transitional typing. */
export interface EventStreamRunnable {
  streamEvents: (input: unknown, options: Record<string, unknown>) => AsyncIterable<unknown>;
}
