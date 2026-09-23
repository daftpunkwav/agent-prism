/**
 * @file pair-safety tests
 * @description Locks assistant/tool pair integrity for the lossy budget strategies.
 *
 * Both orphan shapes (tool result without its kept requester; kept assistant
 * whose tool results were shed) are hard provider errors, so shedding must
 * never create them from a well-formed transcript.
 */
import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { applySourceBudget } from "../../src/context/budget-strategy.js";
import { applyTokenBudget } from "../../src/context/token-budget.js";
import { stripUnpairedToolTurns } from "../../src/context/pair-safety.js";

function toolMsg(id: string, content: string): LlmMessage {
  return { role: "tool", content, toolCallId: id };
}

/** Well-formed one-round transcript: request then result, then follow-up turns. */
function roundTranscript(): LlmMessage[] {
  return [
    { role: "user", content: "q0" },
    { role: "assistant", content: "thinking", toolCalls: [{ id: "c1", name: "bash", args: {} }] },
    toolMsg("c1", "old-output\n".repeat(2000)),
    { role: "user", content: "q1" },
    { role: "assistant", content: "recent reasoning" },
    { role: "user", content: "latest question" },
  ];
}

describe("stripUnpairedToolTurns", () => {
  it("keeps answerable calls and drops their kept results when the requester was shed", () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: "kept", toolCalls: [{ id: "c1", name: "bash", args: {} }] },
      toolMsg("c1", "kept result"),
      { role: "user", content: "tail" },
    ];
    expect(stripUnpairedToolTurns(messages)).toEqual(messages);
  });

  it("strips unanswerable calls and drops results whose requester was shed", () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: "orphaned request", toolCalls: [{ id: "c1", name: "bash", args: {} }] },
      toolMsg("c2", "result of a shed requester"),
      { role: "user", content: "tail" },
    ];
    const out = stripUnpairedToolTurns(messages);
    expect(out).toEqual([
      { role: "assistant", content: "orphaned request" },
      { role: "user", content: "tail" },
    ]);
  });

  it("keeps only the answerable subset of a partially answered call batch", () => {
    const messages: LlmMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read", args: {} },
          { id: "c2", name: "bash", args: {} },
        ],
      },
      toolMsg("c1", "kept result"),
      { role: "user", content: "tail" },
    ];
    const out = stripUnpairedToolTurns(messages);
    const assistant = out[0] as Extract<LlmMessage, { role: "assistant" }>;
    expect(assistant.toolCalls).toEqual([{ id: "c1", name: "read", args: {} }]);
    expect(out).toContainEqual(toolMsg("c1", "kept result"));
    expect(JSON.stringify(out)).not.toContain('"c2"');
  });

  it("drops a fully shed call shell that carries no text (empty assistant body is a wire error)", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "bash", args: {} }] },
      toolMsg("c2", "result of a shed requester"),
      { role: "user", content: "tail" },
    ];
    const out = stripUnpairedToolTurns(messages);
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "tail" },
    ]);
  });

  it("keeps a fully shed call shell that still carries text, without its calls", () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: "reasoning only", toolCalls: [{ id: "c1", name: "bash", args: {} }] },
      { role: "user", content: "tail" },
    ];
    const out = stripUnpairedToolTurns(messages);
    expect(out).toEqual([{ role: "assistant", content: "reasoning only" }, { role: "user", content: "tail" }]);
  });
});

describe("shedding stays pair-safe", () => {
  it("budget: shedding a tool result does not leave its request on the kept assistant", () => {
    const out = applySourceBudget(roundTranscript(), { budgetTokens: 60, charsPerToken: 4 });
    const json = JSON.stringify(out);
    if (json.includes('"c1"')) {
      // When the pair survived, both halves must be present.
      expect(json).toContain("thinking");
      expect(json).toContain("old-output");
    } else {
      // When the result was shed, its call must be gone from the assistant too.
      expect(json).not.toContain('"c1"');
    }
  });

  it("token_budget: shedding a tool result does not leave its request on the kept assistant", () => {
    const out = applyTokenBudget(roundTranscript(), { budget: 2000, keepTurns: 3 });
    const json = JSON.stringify(out);
    expect(json).not.toContain("old-output"); // shed, per the strategy contract
    expect(json).not.toContain('"c1"'); // so the kept assistant must not request it
    expect(json).toContain("recent reasoning");
    expect(json).toContain("latest question");
  });
});
