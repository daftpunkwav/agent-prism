/**
 * @file tool-tail-budget test
 * @description Locks the tool_tail and token_budget context strategies.
 */
import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { applyContextPipeline } from "../src/context/pipeline.js";
import { prepareMessagesForLlm } from "../src/context/messages.js";
import { applyTokenBudget } from "../src/context/token-budget.js";
import { applyToolTail, pruneToolResult } from "../src/context/tool-tail.js";
import { createBuiltinContextPolicyRegistry } from "../src/context/policy-registry.js";

function toolMsg(name: string, content: string): LlmMessage {
  return { role: "tool", content, toolCallId: `c-${name}`, name };
}

describe("pruneToolResult", () => {
  it("passes short results through and keeps error tails of long ones", () => {
    expect(pruneToolResult("ok", "run")).toBe("ok");
    const body = `${"setup log line\n".repeat(500)}FATAL: null pointer in main.go:42`;
    const pruned = pruneToolResult(body, "run");
    expect(pruned.length).toBeLessThan(body.length);
    expect(pruned).toContain("FATAL: null pointer in main.go:42");
    expect(pruned).toContain("tool_tail pruned run");
  });

  it("keeps listing heads for ls/glob", () => {
    const body = Array.from({ length: 500 }, (_, i) => `file-${i}.ts`).join("\n");
    const pruned = pruneToolResult(body, "ls");
    expect(pruned).toContain("file-0.ts");
    expect(pruned).toContain("head-kept");
  });
});

describe("applyToolTail", () => {
  it("keeps every turn and only compacts bulky tool payloads", () => {
    const big = `x\n`.repeat(3000);
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "reasoning here", toolCalls: [{ id: "1", name: "run", args: {} }] },
      toolMsg("run", big),
    ];
    const out = applyToolTail(messages);
    expect(out.length).toBe(messages.length);
    expect(out[2]).toMatchObject({ role: "assistant" });
    expect((out[3] as { content: string }).content.length).toBeLessThan(big.length);
  });
});

describe("applyTokenBudget", () => {
  it("drops stale tool results first and records a ledger", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q0" },
      { role: "assistant", content: "a0", toolCalls: [{ id: "0", name: "run", args: {} }] },
      toolMsg("run", "old-output\n".repeat(2000)),
      { role: "user", content: "q1" },
      { role: "assistant", content: "recent reasoning" },
      toolMsg("run", "new-output"),
      { role: "user", content: "latest question" },
    ];
    const out = applyTokenBudget(messages, { budget: 2000, keepTurns: 3 });
    const text = out.map((m) => (m.role === "system" ? m.content : "")).join("\n");
    expect(text).toContain("Budget ledger");
    expect(JSON.stringify(out)).not.toContain("old-output");
    expect(JSON.stringify(out)).toContain("recent reasoning");
    expect(JSON.stringify(out)).toContain("latest question");
  });

  it("returns short transcripts untouched without a ledger", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    expect(applyTokenBudget(messages)).toEqual(messages);
  });
});

describe("pipeline routing", () => {
  it("accepts the new strategies and still rejects unknown ones", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
    for (const strategy of ["tool_tail", "token_budget"] as const) {
      expect(() => applyContextPipeline(messages, strategy)).not.toThrow();
      expect(prepareMessagesForLlm(messages, strategy).length).toBeGreaterThan(0);
    }
    expect(() => applyContextPipeline(messages, "bogus")).toThrow();
  });

  it("registers all six policies", () => {
    expect(createBuiltinContextPolicyRegistry().listIds()).toEqual([
      "hybrid", "sliding", "summary", "token_budget", "tool_tail", "vector",
    ]);
  });
});
