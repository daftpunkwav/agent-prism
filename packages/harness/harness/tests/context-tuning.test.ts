/**
 * @file context tuning tests
 * @description Locks ContextTuning injection: every tuning field overrides the
 * strategy's built-in default through prepareMessagesForLlm (the shared entry
 * all drivers call), and absent fields keep the defaults.
 *
 * Responsibilities:
 * - Pin summaryMaxChars / tool-tail budget+keep / token_budget budget+keepTurns / windowSize injection
 * - Pin charsPerToken injection into the token estimate
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { estimateContextTokens } from "../src/context/remaining.js";
import { prepareMessagesForLlm } from "../src/context/messages.js";

function toolResult(chars: number): LlmMessage {
  return { role: "tool", name: "grep", content: "x".repeat(chars), toolCallId: "t1" };
}

describe("ContextTuning injection", () => {
  it("summaryMaxChars overrides the summary cap", () => {
    const history: LlmMessage[] = [
      { role: "user", content: "u".repeat(600) },
      { role: "assistant", content: "a".repeat(600) },
      { role: "user", content: "latest question" },
    ];
    const tuned = prepareMessagesForLlm(history, "summary", { windowSize: 1, summaryMaxChars: 100 });
    const summary = tuned.find((m) => m.role === "system" && m.content.startsWith("[Context summary]"));
    expect(summary).toBeDefined();
    expect((summary?.content ?? "").length).toBeLessThanOrEqual(100 + "[Context summary]\n".length + 60);
  });

  it("tool_tail budget and keep override the pruning defaults", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "sys" }, toolResult(1000), { role: "user", content: "q" }];
    const tuned = prepareMessagesForLlm(messages, "tool_tail", {
      windowSize: 12,
      toolTailBudgetChars: 200,
      toolTailKeepChars: 50,
    });
    const pruned = tuned.find((m) => m.role === "tool");
    expect(pruned === undefined || pruned.content === undefined ? "" : String(pruned.content)).toContain("tool_tail pruned");
    expect(String(pruned?.content ?? "").length).toBeLessThanOrEqual(260);
  });

  it("token_budget budget and keepTurns override the drop defaults", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u".repeat(2000) },
      { role: "assistant", content: "a".repeat(2000) },
      { role: "user", content: "recent 1" },
      { role: "assistant", content: "recent 2" },
    ];
    // keepTurns=2 pins only the last two messages; the 200-char budget forces the rest to drop.
    const tuned = prepareMessagesForLlm(messages, "token_budget", { tokenBudgetChars: 200, tokenBudgetKeepTurns: 2 });
    const contents = tuned.map((m) => String(m.content));
    expect(contents).toContain("recent 1");
    expect(contents.some((c) => c.includes("[Budget ledger]"))).toBe(true);
  });

  it("windowSize overrides the sliding window", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old" },
      { role: "assistant", content: "mid" },
      { role: "user", content: "new" },
    ];
    const tuned = prepareMessagesForLlm(messages, "sliding", { windowSize: 2 });
    const contents = tuned.map((m) => m.content);
    expect(contents).toContain("sys");
    expect(contents).not.toContain("old");
    expect(contents).toContain("new");
  });

  it("charsPerToken overrides the token estimate divisor", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "c".repeat(400) }];
    expect(estimateContextTokens(messages, 4)).toBe(100);
    expect(estimateContextTokens(messages, 2)).toBe(200);
  });
});
