// @vitest-environment jsdom
/**
 * @file builder trace helper tests
 * @description Covers the pure display helpers behind the builder observability panel.
 *
 * Responsibilities:
 * - Pin trace-kind accent mapping and log-row shaping
 * - Lock journal record grouping: persisted entries, deduped merge, settled turns
 * - Pin assistant work-trail re-attachment across reloads
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent, BuilderChatMessage, BuilderTraceEntry, BuilderTraceRecord } from "@agentprism/client";
import {
  attachTurnSegments,
  eventRow,
  mergedTraceEntries,
  persistedTraceEntries,
  segmentsOf,
  settledTurns,
  traceAccent,
  traceRow,
} from "../src/app/builder/builderTrace";

function traceEntry(id: string, kind: BuilderTraceEntry["kind"] = "llm_request"): BuilderTraceEntry {
  return { id, seq: 1, ts: 1_000, turn: 1, kind, title: `entry ${id}`, data: {}, durationMs: null };
}

function tokenEvent(ts: number): ArenaEvent {
  return {
    type: "token_update",
    pipeline: "col",
    workspace: "ws",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r1",
    timestamp: ts,
  } as never as ArenaEvent;
}

describe("trace display helpers", () => {
  it("maps each trace kind to its accent spectrum with a muted default", () => {
    expect(traceAccent("llm_request")).toBe("var(--spectrum-1)");
    expect(traceAccent("llm_response")).toBe("var(--spectrum-3)");
    expect(traceAccent("llm_error")).toBe("var(--destructive)");
    expect(traceAccent("swap")).toBe("var(--spectrum-5)");
    expect(traceAccent("notice")).toBe("var(--spectrum-2)");
    expect(traceAccent("phase" as BuilderTraceEntry["kind"])).toBe("var(--muted-foreground)");
  });

  it("shapes log rows for trace entries and arena events", () => {
    expect(traceRow(traceEntry("t1"))).toMatchObject({ source: "trace", ts: 1000, label: "llm_request", detail: "entry t1" });
    const row = eventRow({
      ...tokenEvent(2_000),
      type: "action",
      tool: "read",
      args: { path: "a.txt" },
    } as never as ArenaEvent);
    expect(row.source).toBe("event");
    expect(row.detail).toContain("read");
  });

  it("summarizes observation and token_update rows without overflowing detail", () => {
    const observation = eventRow({
      ...tokenEvent(1),
      type: "observation",
      tool: "grep",
      result: "x".repeat(400),
    } as ArenaEvent);
    expect(observation.detail).toContain("grep");
    expect(observation.detail.length).toBeLessThan(200);
    expect(eventRow(tokenEvent(2)).detail).toBe("token stats");
  });
});

describe("journal record helpers", () => {
  const records: BuilderTraceRecord[] = [
    { kind: "turn", turn: 1, ts: 100, user: "what?" } as BuilderTraceRecord,
    { kind: "trace", entry: traceEntry("a") } as BuilderTraceRecord,
    { kind: "event", turn: 1, event: tokenEvent(101) } as BuilderTraceRecord,
    { kind: "event", turn: 9, event: tokenEvent(102) } as BuilderTraceRecord, // orphan event dropped
  ];

  it("extracts persisted trace entries only", () => {
    expect(persistedTraceEntries(records).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("merges live entries after persisted ones, deduped by id", () => {
    const merged = mergedTraceEntries(records, [traceEntry("a"), traceEntry("b")]);
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("groups settled turns with their user message and events, dropping orphans", () => {
    const turns = settledTurns(records);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn).toMatchObject({ turn: 1, user: "what?" });
    expect(turn.events).toHaveLength(1);
  });
});

describe("attachTurnSegments", () => {
  it("re-attaches each assistant bubble's work trail by turn number", () => {
    const history: BuilderChatMessage[] = [
      { role: "user", content: "q", turn: 1 },
      { role: "assistant", content: "a", turn: 1 },
      { role: "assistant", content: "legacy" }, // no turn number: passes through clean
    ];
    const records: BuilderTraceRecord[] = [
      { kind: "turn", turn: 1, ts: 100, user: "q" } as BuilderTraceRecord,
      { kind: "event", turn: 1, event: tokenEvent(101) } as BuilderTraceRecord,
    ];
    const entries = attachTurnSegments(history, records);
    expect(entries[0]).toEqual({ role: "user", content: "q" });
    expect(entries[2]).toEqual({ role: "assistant", content: "legacy" });
    // The assistant bubble carries merged segments when its turn produced events.
    expect(entries[1]!.role).toBe("assistant");
  });

  it("leaves assistant bubbles segment-free when their turn produced no events", () => {
    const entries = attachTurnSegments([{ role: "assistant", content: "a", turn: 5 }], []);
    expect(entries[0]).toEqual({ role: "assistant", content: "a" });
  });
});

describe("segmentsOf", () => {
  it("delegates to the shared arena-view merger (banner aware)", () => {
    const thought = {
      ...tokenEvent(1),
      type: "thought",
      content: "thinking through it",
    } as ArenaEvent;
    const segments = segmentsOf([thought]);
    expect(segments.length).toBeGreaterThan(0);
  });
});
