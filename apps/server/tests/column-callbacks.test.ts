/**
 * @file column callbacks tests
 * @description Locks the host wiring of model-call health reporting.
 *
 * Responsibilities:
 * - Pin that the breaker's health hook reaches the callback handler
 * - Pin that a host asking only for wire logs still gets its callback
 * - Pin that no sink at all means no callbacks (no needless handler per column)
 *
 * Dropping `onModelCall` in this wiring is silent: the arena breaker would simply
 * never receive a report, the circuit would never open, and no test would fail.
 * These assertions exist so that failure mode shows up here instead.
 */

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { describe, expect, it, vi } from "vitest";
import { buildColumnCallbacks } from "../src/assemble.js";

const now = (): number => 1_700_000_000_000;

/** Minimal LLMResult the handler's success path can serialize. */
const endOutput = () =>
  ({
    generations: [[{ text: "hi", message: { content: "hi", response_metadata: {} } }]],
    llmOutput: {},
  }) as never;

function callHandlers(callbacks: [BaseCallbackHandler] | undefined, invoke: (handler: BaseCallbackHandler) => void): void {
  expect(callbacks).toBeDefined();
  for (const handler of callbacks as [BaseCallbackHandler]) invoke(handler);
}

describe("buildColumnCallbacks", () => {
  it("forwards the host's health hook so a completed call is reported", () => {
    const onModelCall = vi.fn();
    const callbacks = buildColumnCallbacks({ wireSink: () => undefined, onModelCall }, now);
    callHandlers(callbacks, (handler) => {
      handler.handleChatModelStart?.({} as never, [[]], "run-1", undefined, {});
      handler.handleLLMEnd?.(endOutput(), "run-1");
    });
    expect(onModelCall).toHaveBeenCalledWith({ ok: true });
  });

  it("reports a failed call with its error, unless it was a cancellation", () => {
    const onModelCall = vi.fn();
    const callbacks = buildColumnCallbacks({ wireSink: () => undefined, onModelCall }, now);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    callHandlers(callbacks, (handler) => {
      handler.handleLLMError?.(new Error("connection reset"), "run-2");
      handler.handleLLMError?.(abort, "run-3");
    });
    expect(onModelCall).toHaveBeenCalledTimes(1);
    expect(onModelCall.mock.calls[0]?.[0]).toMatchObject({ ok: false });
  });

  it("still builds a handler when the host only asked for wire logs", () => {
    const wireSink = vi.fn();
    const callbacks = buildColumnCallbacks({ wireSink }, now);
    callHandlers(callbacks, (handler) => {
      handler.handleChatModelStart?.({} as never, [[]], "run-4", undefined, {});
      handler.handleLLMEnd?.(endOutput(), "run-4");
    });
    expect(wireSink).toHaveBeenCalled();
  });

  it("returns no callbacks when the host asked for neither", () => {
    expect(buildColumnCallbacks(undefined, now)).toBeUndefined();
    expect(buildColumnCallbacks({}, now)).toBeUndefined();
  });
});
