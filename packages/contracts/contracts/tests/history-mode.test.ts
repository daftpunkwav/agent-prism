/**
 * @file history mode tests
 * @description Locks tool-round extraction and history-mode rendering.
 *
 * Responsibilities:
 * - Pin extractToolRounds action→observation pairing (multi-column, unclosed tail)
 * - Pin renderToolActivity per mode (minimal byte-identity, summary shape, full caps)
 * - Pin wire acceptance of tool_rounds on assistant history entries
 */

import { describe, expect, it } from "vitest";
import {
  ArenaEventSchema,
  ArenaRunRequestSchema,
  ChatMessageSchema,
  clampToolRoundsForWire,
  extractToolRounds,
  HistoryModeSchema,
  MAX_TOOL_ROUNDS_CHARS,
  MAX_TOOL_ROUNDS_PER_MESSAGE,
  renderToolActivity,
  TOOL_ACTIVITY_MAX_CHARS,
  TOOL_ROUND_ARGS_MAX_CHARS,
  toolRoundChars,
  type ArenaEvent,
  type ToolRound,
} from "../src/index.js";

/** Event base requires the nullable-no-default fields explicitly. */
function baseEvent(pipeline: string): Record<string, unknown> {
  return { pipeline, passed: null, metrics: null, token_stats: null };
}

function actionEvent(tool: string, args: Record<string, unknown>, step: number): ArenaEvent {
  return ArenaEventSchema.parse({
    ...baseEvent("Native Agent"),
    type: "action",
    tool,
    args,
    step,
  });
}

function observationEvent(result: string, step: number): ArenaEvent {
  return ArenaEventSchema.parse({
    ...baseEvent("Native Agent"),
    type: "observation",
    result,
    step,
  });
}

describe("extractToolRounds", () => {
  it("pairs each action with the next observation", () => {
    const events = [
      actionEvent("read", { path: "a.txt" }, 1),
      observationEvent("file body", 1),
      actionEvent("run", { command: "python a.txt" }, 2),
      observationEvent("hello", 2),
    ];
    expect(extractToolRounds(events)).toEqual([
      { tool: "read", args: { path: "a.txt" }, result: "file body" },
      { tool: "run", args: { command: "python a.txt" }, result: "hello" },
    ]);
  });

  it("keeps rounds isolated per pipeline column", () => {
    const other: ArenaEvent = ArenaEventSchema.parse({
      ...baseEvent("LangChain"),
      type: "observation",
      result: "other column",
      step: 1,
    });
    const events = [actionEvent("read", { path: "a.txt" }, 1), other, observationEvent("own column", 1)];
    const rounds = extractToolRounds(events);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.result).toBe("own column");
  });

  it("drops an action with no paired observation (unclosed tail)", () => {
    const events = [actionEvent("read", { path: "a.txt" }, 1), actionEvent("run", {}, 2), observationEvent("ok", 2)];
    expect(extractToolRounds(events)).toEqual([{ tool: "run", args: {}, result: "ok" }]);
  });

  it("returns [] for a stream with no tool activity", () => {
    const thought: ArenaEvent = ArenaEventSchema.parse({
      ...baseEvent("p"),
      type: "thought",
      content: "hi",
    });
    expect(extractToolRounds([thought])).toEqual([]);
  });

  it("collapses over-sized args to a bounded preview record at capture", () => {
    const events = [
      actionEvent("write", { content: "x".repeat(TOOL_ROUND_ARGS_MAX_CHARS + 500) }, 1),
      observationEvent("written", 1),
    ];
    const rounds = extractToolRounds(events);
    expect(rounds).toHaveLength(1);
    const preview = (rounds[0]?.args as { preview?: string }).preview;
    expect(typeof preview).toBe("string");
    expect((preview as string).length).toBe(TOOL_ROUND_ARGS_MAX_CHARS);
    // Small args pass through untouched.
    const small = extractToolRounds([actionEvent("read", { path: "a.txt" }, 1), observationEvent("ok", 1)]);
    expect(small[0]?.args).toEqual({ path: "a.txt" });
  });
});

describe("clampToolRoundsForWire", () => {
  const round = (size: number): ToolRound => ({ tool: "read", args: {}, result: "x".repeat(size) });

  it("measures rounds with the same accounting as the wire check", () => {
    expect(toolRoundChars({ tool: "read", args: { path: "a.txt" }, result: "ok" })).toBe(
      "read".length + JSON.stringify({ path: "a.txt" }).length + "ok".length,
    );
  });

  it("keeps the newest rounds within the per-message count cap", () => {
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS_PER_MESSAGE + 6 }, (_, i) => ({ ...round(10), result: `r${i}` }));
    const clamped = clampToolRoundsForWire(rounds);
    expect(clamped).toHaveLength(MAX_TOOL_ROUNDS_PER_MESSAGE);
    expect(clamped[0]?.result).toBe(`r${6}`);
    expect(clamped[clamped.length - 1]?.result).toBe(`r${rounds.length - 1}`);
  });

  it("drops the oldest rounds until the summed char budget holds", () => {
    const big = round(10_000);
    const clamped = clampToolRoundsForWire([big, big, big, big]);
    const total = clamped.reduce((sum, r) => sum + r.tool.length + JSON.stringify(r.args).length + r.result.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOOL_ROUNDS_CHARS);
    expect(clamped).toHaveLength(3);
  });

  it("returns rounds unchanged when they already fit", () => {
    const rounds = [round(10), round(20)];
    expect(clampToolRoundsForWire(rounds)).toEqual(rounds);
  });
});

describe("renderToolActivity", () => {
  const rounds = [
    { tool: "read", args: { path: "a.txt" }, result: "file body" },
    { tool: "bash", args: { command: "python a.txt" }, result: "hello" },
  ];

  it("returns empty for minimal mode or missing rounds", () => {
    expect(renderToolActivity(rounds, "minimal")).toBe("");
    expect(renderToolActivity(undefined, "full")).toBe("");
    expect(renderToolActivity([], "tool_summary")).toBe("");
  });

  it("tool_summary renders one compact line per round", () => {
    const text = renderToolActivity(rounds, "tool_summary");
    expect(text).toContain("[Tool activity from this turn]");
    expect(text).toContain('- read({"path":"a.txt"}) → file body');
    expect(text).toContain('- bash({"command":"python a.txt"}) → hello');
    // summary collapses result whitespace; raw multi-line result must not leak
    const multiline = [{ tool: "run", args: {}, result: "line1\n\nline2" }];
    expect(renderToolActivity(multiline, "tool_summary")).toContain("→ line1 line2");
  });

  it("full mode keeps args and result blocks", () => {
    const text = renderToolActivity(rounds, "full");
    expect(text).toContain("- read\n  args: {\"path\":\"a.txt\"}\n  result: file body");
  });

  it("full mode caps the total appendix at the activity budget", () => {
    const round: ToolRound = { tool: "read", args: {}, result: "x".repeat(7_500) };
    // One round fits under the budget; enough rounds must trip it and emit the marker.
    const big = Array.from({ length: 8 }, () => ({ ...round }));
    const text = renderToolActivity(big, "full");
    expect(text.length).toBeLessThanOrEqual(TOOL_ACTIVITY_MAX_CHARS + 200);
    expect(text).toContain("…(older tool activity truncated)");
  });
});

describe("history wire shapes", () => {
  it("HistoryModeSchema accepts the three modes only", () => {
    expect([...HistoryModeSchema.options]).toEqual(["minimal", "tool_summary", "full"]);
  });

  it("ChatMessageSchema accepts an assistant entry with tool_rounds", () => {
    const parsed = ChatMessageSchema.parse({
      role: "assistant",
      content: "done",
      tool_rounds: [{ tool: "read", args: { path: "a.txt" }, result: "body" }],
    });
    expect(parsed.tool_rounds).toHaveLength(1);
  });

  it("ChatMessageSchema keeps tool_rounds optional (legacy entries unaffected)", () => {
    const parsed = ChatMessageSchema.parse({ role: "assistant", content: "done" });
    expect(parsed.tool_rounds).toBeUndefined();
  });

  it("ChatMessageSchema rejects a tool_rounds entry without a tool name", () => {
    const result = ChatMessageSchema.safeParse({
      role: "assistant",
      content: "done",
      tool_rounds: [{ args: {}, result: "ok" }],
    });
    expect(result.success).toBe(false);
  });

  it("the wire rejects history whose summed rounds chars bust the budget", () => {
    const oversize = "x".repeat(MAX_TOOL_ROUNDS_CHARS);
    const result = ArenaRunRequestSchema.safeParse({
      question: "q",
      messages: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1", tool_rounds: [{ tool: "read", args: {}, result: oversize }] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("Tool rounds exceed the limit"))).toBe(true);
    }
  });

  it("the wire rejects a single message with more rounds than the per-message cap", () => {
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS_PER_MESSAGE + 1 }, () => ({ tool: "read", args: {}, result: "r" }));
    const result = ChatMessageSchema.safeParse({ role: "assistant", content: "done", tool_rounds: rounds });
    expect(result.success).toBe(false);
  });
});
