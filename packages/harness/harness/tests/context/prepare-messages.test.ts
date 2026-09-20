/**
 * @file prepare messages tests
 * @description Locks strategy assembly: windows, tool-pair safety, summaries, retrieval.
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { prepareMessagesForLlm } from "../../src/context/messages.js";

function user(content: string): LlmMessage {
  return { role: "user", content };
}

function assistant(content: string): LlmMessage {
  return { role: "assistant", content };
}

describe("prepareMessagesForLlm", () => {
  it("returns empty for empty input", () => {
    expect(prepareMessagesForLlm([])).toEqual([]);
  });

  it("sliding keeps the most recent window", () => {
    const messages = [user("a"), user("b"), user("c"), user("d")];
    const prepared = prepareMessagesForLlm(messages, "sliding", { windowSize: 2 });
    expect(prepared.map((message) => message.content)).toEqual(["c", "d"]);
  });

  it("never mutates the input", () => {
    const messages = [user("a"), user("b"), user("c")];
    prepareMessagesForLlm(messages, "sliding", { windowSize: 1 });
    expect(messages).toHaveLength(3);
  });

  it("summary folds overflow into a system message", () => {
    const messages = [user("first"), user("second"), user("third")];
    const prepared = prepareMessagesForLlm(messages, "summary", { windowSize: 1 });
    expect(prepared[0]?.role).toBe("system");
    expect(String(prepared[0]?.content)).toContain("Context summary");
    expect(prepared[prepared.length - 1]?.content).toBe("third");
  });

  it("vector appends fenced retrieval as a trailing user message", () => {
    const prepared = prepareMessagesForLlm([user("q"), assistant("a")], "vector", {
      retrieveSnippets: () => "fact",
    });
    const last = prepared[prepared.length - 1];
    expect(last?.role).toBe("user");
    expect(String(last?.content)).toContain("fact");
  });

  it("drops orphan tool results cut off from their assistant turn", () => {
    const messages = [
      { role: "tool", content: "out1" } as LlmMessage,
      { role: "tool", content: "out2" } as LlmMessage,
      { role: "tool", content: "out3" } as LlmMessage,
      user("next"),
    ];
    const prepared = prepareMessagesForLlm(messages, "sliding", { windowSize: 2 });
    expect(prepared.some((message) => message.role === "tool")).toBe(false);
    expect(prepared.map((message) => message.content)).toEqual(["next"]);
  });
});
