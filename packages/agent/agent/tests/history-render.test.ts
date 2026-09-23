/**
 * @file history-render tests
 * @description Locks history-mode rendering at the execution boundary.
 *
 * Responsibilities:
 * - Pin minimal as an identity transform (byte-identical legacy behavior)
 * - Pin tool_summary/full appendix attachment on assistant entries only
 */

import { describe, expect, it } from "vitest";
import { renderHistoryForMode } from "../src/history-render.js";
import type { ChatMessage } from "@agentprism/contracts";

const history: ChatMessage[] = [
  { role: "user", content: "make a file" },
  {
    role: "assistant",
    content: "done",
    tool_rounds: [{ tool: "write", args: { path: "a.txt" }, result: "created" }],
  },
  { role: "user", content: "now run it" },
  { role: "assistant", content: "output: hello" },
];

describe("renderHistoryForMode", () => {
  it("minimal returns the same list (identity)", () => {
    expect(renderHistoryForMode(history, "minimal")).toBe(history);
  });

  it("tool_summary appends one line per round to assistant entries", () => {
    const rendered = renderHistoryForMode(history, "tool_summary");
    expect(rendered[1]?.content).toContain("done");
    expect(rendered[1]?.content).toContain('- write({"path":"a.txt"}) → created');
    // round-less entries stay untouched
    expect(rendered[3]?.content).toBe("output: hello");
    expect(rendered[0]?.content).toBe("make a file");
  });

  it("full appends args and result blocks", () => {
    const rendered = renderHistoryForMode(history, "full");
    expect(rendered[1]?.content).toContain("  args: {\"path\":\"a.txt\"}");
    expect(rendered[1]?.content).toContain("  result: created");
  });

  it("never mutates the input list", () => {
    const snapshot = JSON.stringify(history);
    renderHistoryForMode(history, "full");
    expect(JSON.stringify(history)).toBe(snapshot);
  });
});
