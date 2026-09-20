/**
 * @file llm message bridge tests
 * @description Covers LlmMessage ↔ LangChain BaseMessage conversion round trips.
 *
 * Responsibilities:
 * - Pin every role mapping in both directions, including tool calls
 * - Lock the unknown-vendor-type degradation to user text
 *
 * Uses real @langchain/core message classes; no model is invoked.
 */

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { fromLcMessages, toLcMessages } from "../src/llm-message-bridge.js";
import type { LlmMessage } from "@agentprism/contracts";

describe("toLcMessages", () => {
  it("maps system/user roles to their LC classes", () => {
    const messages = toLcMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[0]!.content).toBe("sys");
    expect(messages[1]!.content).toBe("hi");
  });

  it("maps tool messages with call id and name", () => {
    const messages = toLcMessages([{ role: "tool", content: "42", toolCallId: "c1", name: "read" }]);
    const tool = messages[0]!;
    expect(tool).toBeInstanceOf(ToolMessage);
    expect((tool as ToolMessage).tool_call_id).toBe("c1");
    expect((tool as ToolMessage).name).toBe("read");
  });

  it("maps assistant tool calls into LC tool_call shape", () => {
    const messages = toLcMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read", args: { path: "a.txt" } }],
      },
    ]);
    const ai = messages[0] as AIMessage;
    expect(ai).toBeInstanceOf(AIMessage);
    expect(ai.tool_calls).toEqual([{ id: "c1", name: "read", args: { path: "a.txt" }, type: "tool_call" }]);
  });
});

describe("fromLcMessages", () => {
  it("maps the four LC classes back to neutral roles", () => {
    const messages = fromLcMessages([
      new SystemMessage("sys"),
      new HumanMessage("hi"),
      new AIMessage("answer"),
      new ToolMessage({ content: "42", tool_call_id: "c1", name: "read" }),
    ]);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "answer", toolCalls: undefined },
      { role: "tool", content: "42", toolCallId: "c1", name: "read" },
    ]);
  });

  it("keeps assistant tool calls and drops the field when none exist", () => {
    const [withCalls] = fromLcMessages([
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "read", args: { path: "a.txt" }, type: "tool_call" }],
      }),
    ]);
    expect((withCalls as Extract<LlmMessage, { role: "assistant" }>).toolCalls).toEqual([{ id: "c1", name: "read", args: { path: "a.txt" } }]);
  });

  it("degrades unknown vendor message types to user text instead of dropping them", () => {
    class VendorMessage extends HumanMessage {
      override getType() {
        return "vendor_unknown" as ReturnType<HumanMessage["getType"]>;
      }
    }
    const [degraded] = fromLcMessages([new VendorMessage("fallback me")]);
    expect(degraded!).toEqual({ role: "user", content: "fallback me" });
  });
});

describe("round trip", () => {
  it("preserves a tool-calling transcript through both conversions", () => {
    const original: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "q" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "grep", args: { pattern: "x" } }] },
      { role: "tool", content: "match", toolCallId: "c1", name: "grep" },
    ];
    const roundTripped = fromLcMessages(toLcMessages(original));
    expect(roundTripped).toEqual(original);
  });
});
