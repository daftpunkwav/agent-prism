// @vitest-environment node
/**
 * @file child-bridge tests
 * @description Covers the NDJSON bridge engine with a fake bootstrap: event
 *              pass-through, tool round-trip, llm round-trip, final answer,
 *              the failure path when the child exits without one, and the
 *              abort path (kill + abort reason as the failure).
 */

import { describe, expect, it } from "vitest";
import {
  runChildBridge,
  type ChildBridgeOptions,
  type ChildBridgeOutcome,
} from "@agentprism/driver-run-support";
import { fileURLToPath } from "node:url";

const FAKE_BOOTSTRAP = fileURLToPath(new URL("./fake-bootstrap.mjs", import.meta.url));

function baseOptions(overrides: Record<string, unknown> = {}): ChildBridgeOptions {
  return {
    command: process.execPath,
    args: [FAKE_BOOTSTRAP, JSON.stringify(overrides)],
    cwd: process.cwd(),
    start: {
      type: "start",
      question: "q?",
      tools: [{ name: "read", description: "reads", parameters: { type: "object", properties: {} } }],
      maxSteps: 6,
    },
    handlers: {
      llmComplete: async () => JSON.stringify({ content: "model says hi", toolCalls: [] }),
      toolExecute: async (request: { name: string; args: string }) => `ran ${request.name}`,
    },
    onEvent: undefined,
  };
}

describe("runChildBridge", () => {
  it("round-trips llm and tool requests and lands on the final answer", async () => {
    const events: string[] = [];
    const outcome = await runChildBridge({
      ...baseOptions({ scenario: "happy" }),
      onEvent: (message) => {
        if (message.type === "event") events.push(message.content);
      },
    });
    expect(outcome).toEqual({ ok: true, answer: "bridge answer" });
    expect(events).toEqual(["phase-1", "assistant-1:ran read"]);
  });

  it("reports the child's error message as a failure", async () => {
    const outcome: ChildBridgeOutcome = await runChildBridge(baseOptions({ scenario: "error" }));
    expect(outcome).toEqual({ ok: false, message: "framework exploded" });
  });

  it("drops valid-JSON non-protocol lines and still lands the final answer", async () => {
    // A bare `null` line used to throw inside the async handler (unhandled
    // rejection); the guard must skip it along with scalars and arrays.
    const outcome = await runChildBridge(baseOptions({ scenario: "junk" }));
    expect(outcome).toEqual({ ok: true, answer: "bridge answer" });
  });

  it("reports a spawn failure as a failure instead of crashing the process", async () => {
    const outcome: ChildBridgeOutcome = await runChildBridge({
      ...baseOptions({ scenario: "happy" }),
      command: "definitely-not-a-real-binary-xyz",
      args: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("failed to run bootstrap");
    }
  });

  it("reports a failure when the child exits without a final", async () => {
    const outcome: ChildBridgeOutcome = await runChildBridge(baseOptions({ scenario: "silent" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("without a final answer");
    }
  });

  it("kills the child on abort and reports the abort reason as a failure", async () => {
    const controller = new AbortController();
    // Abort fires while the llm handler is still in flight: the session must
    // settle through the child kill, and the late handler result must hit the
    // guarded dead-stdin write without taking the process down.
    const timer = setTimeout(() => controller.abort(new Error("stopped by test")), 100);
    try {
      const outcome: ChildBridgeOutcome = await runChildBridge({
        ...baseOptions({ scenario: "hang" }),
        signal: controller.signal,
        handlers: {
          llmComplete: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            return JSON.stringify({ content: "too late", toolCalls: [] });
          },
          toolExecute: async () => "unused",
        },
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).toContain("stopped by test");
      }
    } finally {
      clearTimeout(timer);
    }
  }, 15_000);
});
