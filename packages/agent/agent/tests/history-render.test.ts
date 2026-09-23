/**
 * @file history-render tests
 * @description Locks history-mode rendering at the execution boundary.
 *
 * Responsibilities:
 * - Pin minimal as bare Q/A pairs (no tool trace anywhere)
 * - Pin tool_summary appendix attachment on assistant entries
 * - Pin full-mode chronological expansion: assistant(tool_calls) → tool results → answer
 */

import { describe, expect, it } from "vitest";
import { renderHistoryForMode } from "../src/history-render.js";
import type { ChatMessage } from "@agentprism/contracts";

const history: ChatMessage[] = [
  { role: "user", content: "make a file" },
  {
    role: "assistant",
    content: "done",
    tool_rounds: [
      { tool: "write", args: { path: "a.txt" }, result: "created" },
      { tool: "run", args: { command: "python a.txt" }, result: "hello" },
    ],
  },
  { role: "user", content: "now run it" },
  { role: "assistant", content: "output: hello" },
];

describe("renderHistoryForMode", () => {
  it("minimal keeps bare Q/A pairs with no tool trace", () => {
    const rendered = renderHistoryForMode(history, "minimal");
    expect(rendered).toEqual([
      { role: "user", content: "make a file" },
      { role: "assistant", content: "done" },
      { role: "user", content: "now run it" },
      { role: "assistant", content: "output: hello" },
    ]);
    expect(JSON.stringify(rendered)).not.toContain("tool");
  });

  it("tool_summary appends one line per round to the assistant answer", () => {
    const rendered = renderHistoryForMode(history, "tool_summary");
    expect(rendered).toHaveLength(4);
    const answer = rendered[1];
    expect(answer?.role).toBe("assistant");
    expect(answer?.content).toContain("done");
    expect(answer?.content).toContain('- write({"path":"a.txt"}) → created');
    // round-less entries stay untouched
    expect(rendered[3]?.content).toBe("output: hello");
  });

  it("full expands each turn chronologically: shell(tool_calls) → tool results → answer", () => {
    const rendered = renderHistoryForMode(history, "full");
    expect(rendered.map((m) => m.role)).toEqual([
      "user",
      "assistant", // shell
      "tool",
      "tool",
      "assistant", // answer
      "user",
      "assistant",
    ]);
    const shell = rendered[1];
    if (shell === undefined || shell.role !== "assistant") throw new Error("expected assistant shell");
    expect(shell.content).toBe("");
    expect(shell.toolCalls).toEqual([
      { id: "hist_1_0", name: "write", args: { path: "a.txt" } },
      { id: "hist_1_1", name: "run", args: { command: "python a.txt" } },
    ]);
    expect(rendered[2]).toEqual({ role: "tool", content: "created", toolCallId: "hist_1_0", name: "write" });
    expect(rendered[3]).toEqual({ role: "tool", content: "hello", toolCallId: "hist_1_1", name: "run" });
    expect(rendered[4]?.content).toBe("done");
  });

  it("full keeps round-less entries as bare pairs", () => {
    const rendered = renderHistoryForMode(history, "full");
    expect(rendered[5]).toEqual({ role: "user", content: "now run it" });
    expect(rendered[6]).toEqual({ role: "assistant", content: "output: hello" });
  });

  it("never mutates the input list", () => {
    const snapshot = JSON.stringify(history);
    renderHistoryForMode(history, "full");
    expect(JSON.stringify(history)).toBe(snapshot);
  });
});
