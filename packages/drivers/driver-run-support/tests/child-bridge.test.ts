// @vitest-environment node
/**
 * @file child-bridge tests
 * @description Covers the NDJSON bridge engine with a fake bootstrap: event
 *              pass-through, tool round-trip, llm round-trip, final answer,
 *              and the failure path when the child exits without one.
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
      history: [],
      tools: [{ name: "read", description: "reads", parameters: { type: "object", properties: {} } }],
      maxSteps: 6,
      language: "",
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

  it("reports a failure when the child exits without a final", async () => {
    const outcome: ChildBridgeOutcome = await runChildBridge(baseOptions({ scenario: "silent" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("without a final answer");
    }
  });
});
