/**
 * @file tool-replay tests
 * @description Locks the tool-replay dimension: replay granularity, pairing
 * preservation, and per-call attribution inside a parallel batch.
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { omitResults, toolReplayDimension } from "../src/index.js";

const TRANSCRIPT: LlmMessage[] = [
  { role: "user", content: "task" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", args: { path: "a.ts" } }] },
  { role: "tool", content: "export function a() {}", toolCallId: "c1", name: "read" },
  { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "write", args: { path: "b.ts", content: "x" } }] },
  { role: "tool", content: "Wrote: b.ts", toolCallId: "c2", name: "write" },
];

const replay = (value: string): readonly LlmMessage[] => {
  const hook = toolReplayDimension.hooks?.messages;
  if (hook === undefined) throw new Error("tool-replay must expose a messages hook");
  return hook({ messages: TRANSCRIPT, context: { question: "", custom: {} } }, value);
};

describe("toolReplayDimension", () => {
  it("declares the three granularities with a declared default", () => {
    expect(toolReplayDimension.id).toBe("tool_replay");
    expect(toolReplayDimension.options.map((option) => option.value)).toEqual(["all", "skip_read", "writes_only"]);
    expect(toolReplayDimension.default).toBe("all");
  });

  it("replays everything verbatim for the all value", () => {
    expect(replay("all")).toEqual(TRANSCRIPT);
  });

  it("omits read results and keeps write results (pairs intact)", () => {
    const out = replay("skip_read");
    expect(out[2]?.content).toContain("omitted");
    expect(out[4]?.content).toBe("Wrote: b.ts");
    // Every tool call still has a tool message: providers reject orphan calls.
    expect(out.filter((message) => message.role === "tool")).toHaveLength(2);
  });

  it("keeps only mutating results for the writes-only value", () => {
    const out = replay("writes_only");
    expect(out[2]?.content).toContain("omitted");
    expect(out[4]?.content).toBe("Wrote: b.ts");
  });

  it("attributes parallel results by their own names, not the batch", () => {
    const parallel: LlmMessage[] = [
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read", args: {} },
          { id: "c2", name: "bash", args: {} },
        ],
      },
      { role: "tool", content: "file body", toolCallId: "c1", name: "read" },
      { role: "tool", content: "ran", toolCallId: "c2", name: "bash" },
    ];
    // One assistant turn requesting read+bash: the read result must be omitted
    // even though a sibling call in the same batch is kept.
    const out = omitResults(parallel, (tool) => tool !== "read");
    expect(out[2]?.content).toContain("omitted");
    expect(out[3]?.content).toBe("ran");
  });

  it("uses the non-mutating marker for results outside the read set", () => {
    const other: LlmMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web_fetch", args: {} }] },
      { role: "tool", content: "page body", toolCallId: "c1", name: "web_fetch" },
    ];
    const out = omitResults(other, (tool) => tool === "write");
    expect(out[2]?.content).toContain("non-mutating");
  });
});
