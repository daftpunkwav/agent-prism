/**
 * @file input-bridge tests
 * @description Locks the Agents SDK input item ⇄ neutral message conversion.
 *
 * Responsibilities:
 * - Cover every item kind the SDK produces (messages, function calls, results)
 * - Cover the inverse projection used to seed a run from history
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { fromLlmMessages, toLlmMessages } from "../src/input-bridge.js";

describe("toLlmMessages", () => {
  it("wraps a bare string prompt as a user turn", () => {
    expect(toLlmMessages("hello")).toEqual([{ role: "user", content: "hello" }]);
  });

  it("maps message roles and flattens content blocks", () => {
    const messages = toLlmMessages([
      { role: "system", content: "sys" },
      { role: "developer", content: [{ type: "input_text", text: "dev" }] },
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      { role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ]);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "system", content: "dev" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("regroups consecutive function calls into one assistant turn", () => {
    const messages = toLlmMessages([
      { type: "function_call", name: "a", arguments: '{"x":1}', callId: "c1" },
      { type: "function_call", name: "b", arguments: "not json", callId: "c2" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "a", args: { x: 1 } },
        { id: "c2", name: "b", args: { input: "not json" } },
      ],
    });
  });

  it("maps function_call_result items to tool turns", () => {
    const messages = toLlmMessages([
      { type: "function_call_result", callId: "c1", name: "a", output: "done" },
      { type: "function_call_result", callId: "c2", output: [{ type: "text", text: "block" }] },
      { type: "reasoning", content: [] },
      null,
    ]);
    expect(messages).toEqual([
      { role: "tool", content: "done", toolCallId: "c1", name: "a" },
      { role: "tool", content: "block", toolCallId: "c2" },
    ]);
  });
});

describe("fromLlmMessages", () => {
  it("drops the system turn and keeps the conversation order", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(fromLlmMessages(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ]);
  });

  it("expands assistant tool calls into one item per call and keeps tool results", () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "a", args: { x: 1 } }] },
      { role: "tool", content: "done", toolCallId: "c1", name: "a" },
    ];
    expect(fromLlmMessages(messages)).toEqual([
      { type: "function_call", callId: "c1", name: "a", arguments: '{"x":1}' },
      { type: "function_call_result", callId: "c1", name: "a", output: "done" },
    ]);
  });

  it("round-trips a tool round back into the same neutral messages", () => {
    const original: LlmMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "a", args: { x: 1 } }] },
      { role: "tool", content: "done", toolCallId: "c1", name: "a" },
      { role: "assistant", content: "final" },
    ];
    expect(toLlmMessages(fromLlmMessages(original))).toEqual(original);
  });
});
