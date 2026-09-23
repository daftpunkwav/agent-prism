/**
 * @file initial messages tests
 * @description Locks buildInitialMessages history passthrough semantics.
 *
 * Responsibilities:
 * - Pin bare Q/A passthrough and empty-text skipping (legacy behavior)
 * - Pin tool-turn passthrough and the tool-calls shell (full-mode expansion input)
 */

import { describe, expect, it } from "vitest";
import { buildInitialMessages } from "../src/prompt/assembly.js";
import type { ChatTurnMessage } from "@agentprism/contracts";

describe("buildInitialMessages", () => {
  it("builds system + history + current user, skipping empty-text turns", () => {
    const history: ChatTurnMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "a1" },
    ];
    expect(buildInitialMessages("sys", "q2", history)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("passes tool turns through verbatim (full-mode replay)", () => {
    const history: ChatTurnMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "", toolCalls: [{ id: "hist_1_0", name: "write", args: { path: "a" } }] },
      { role: "tool", content: "created", toolCallId: "hist_1_0", name: "write" },
      { role: "assistant", content: "done" },
    ];
    const messages = buildInitialMessages("sys", "q2", history);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "", toolCalls: [{ id: "hist_1_0", name: "write", args: { path: "a" } }] },
      { role: "tool", content: "created", toolCallId: "hist_1_0", name: "write" },
      { role: "assistant", content: "done" },
      { role: "user", content: "q2" },
    ]);
  });

  it("keeps an empty-content assistant that carries tool calls (the expansion shell)", () => {
    const history: ChatTurnMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "ls", args: {} }] },
    ];
    const messages = buildInitialMessages("sys", "hi", history);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "ls", args: {} }],
    });
  });
});
