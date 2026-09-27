// @vitest-environment node
/**
 * @file bridge-protocol tests
 * @description Covers the shared wire-to-model projections both framework bridges
 *              rely on: tool-call args parse, malformed args degrade to an empty
 *              object, role mapping falls through to user, and the transcript's
 *              prior tool calls are read for the drift guard.
 */

import { describe, expect, it } from "vitest";
import { priorToolNamesFromWire, toLlmMessage } from "@agentprism/driver-run-support";

describe("toLlmMessage", () => {
  it("parses assistant tool-call args and drops the field when none remain", () => {
    const message = toLlmMessage({
      role: "assistant",
      content: "working",
      toolCalls: [{ id: "t1", name: "read", args: '{"path":"a.txt"}' }],
    });
    expect(message).toEqual({
      role: "assistant",
      content: "working",
      toolCalls: [{ id: "t1", name: "read", args: { path: "a.txt" } }],
    });
    const plain = toLlmMessage({ role: "assistant", content: "done", toolCalls: [] });
    expect(plain).toEqual({ role: "assistant", content: "done" });
  });

  it("degrades malformed tool-call args to an empty object", () => {
    const message = toLlmMessage({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t2", name: "bash", args: "not json" }],
    });
    expect(message).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t2", name: "bash", args: {} }],
    });
  });

  it("maps tool, system, and unknown roles", () => {
    expect(toLlmMessage({ role: "tool", content: "ok", toolCallId: "t1", name: "read" })).toEqual({
      role: "tool",
      content: "ok",
      toolCallId: "t1",
      name: "read",
    });
    expect(toLlmMessage({ role: "system", content: "behave" })).toEqual({ role: "system", content: "behave" });
    expect(toLlmMessage({ role: "user", content: "hi" })).toEqual({ role: "user", content: "hi" });
  });
});

describe("priorToolNamesFromWire", () => {
  it("collects every assistant tool call carried by the transcript, in order", () => {
    expect(
      priorToolNamesFromWire([
        { role: "user", content: "q" },
        { role: "assistant", content: "", toolCalls: [{ id: "a", name: "read", args: "{}" }] },
        { role: "tool", content: "out", toolCallId: "a", name: "read" },
        { role: "assistant", content: "", toolCalls: [{ id: "b", name: "write", args: "{}" }, { id: "c", name: "bash", args: "{}" }] },
      ]),
    ).toEqual(["read", "write", "bash"]);
    expect(priorToolNamesFromWire([{ role: "user", content: "q" }])).toEqual([]);
  });
});
