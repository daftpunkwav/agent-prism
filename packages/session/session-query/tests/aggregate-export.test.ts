/**
 * @file aggregate-export test
 * @description Locks counts, histograms, activity buckets, and export assembly.
 */
import { describe, expect, it } from "vitest";
import { activityByDay, countSessions, emptyCounts, entryHistogram } from "../src/aggregate.js";
import { exportSessionDocument } from "../src/export-doc.js";
import type { SessionEntry, SessionRecord } from "@agentprism/contracts";

function record(partial: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    kind: "arena", title: "t", status: "active", createdAt: 1, updatedAt: 1,
    summary: null, metadata: {}, entryCount: 0, ...partial,
  };
}

describe("aggregations", () => {
  it("counts by kind/status ignoring unknown enums", () => {
    const counts = countSessions([
      record({ id: "a", kind: "arena", status: "completed" }),
      record({ id: "b", kind: "agent", status: "active" }),
      record({ id: "c", kind: "bogus" as never, status: "active" }),
    ]);
    expect(counts.arena.completed).toBe(1);
    expect(counts.agent.active).toBe(1);
    expect(emptyCounts().builder.failed).toBe(0);
  });

  it("histograms entries and buckets activity days", () => {
    const entries: SessionEntry[] = [
      { sessionId: "a", seq: 0, at: 1, kind: "lifecycle", content: "x" },
      { sessionId: "a", seq: 1, at: 2, kind: "verdict", content: "y" },
    ];
    expect(entryHistogram(entries)).toMatchObject({ lifecycle: 1, verdict: 1, note: 0 });
    const day = Date.UTC(2026, 8, 11);
    const buckets = activityByDay([
      record({ id: "a", createdAt: day + 1000 }),
      record({ id: "b", createdAt: day + 2000 }),
      record({ id: "c", createdAt: day + 86_400_000 }),
    ]);
    expect(buckets).toEqual([
      { day: "2026-09-11", sessions: 2 },
      { day: "2026-09-12", sessions: 1 },
    ]);
    expect(activityByDay([record({ id: "a", createdAt: day })], { from: day + 1 })).toEqual([]);
  });
});

describe("exportSessionDocument", () => {
  it("assembles versioned exports with seq ordering", () => {
    const doc = exportSessionDocument(
      record({ id: "a" }),
      [
        { sessionId: "a", seq: 1, at: 2, kind: "note", content: "b" },
        { sessionId: "a", seq: 0, at: 1, kind: "lifecycle", content: "a" },
      ],
      999,
    );
    expect(doc.version).toBe(2);
    expect(doc.exportedAt).toBe(999);
    expect(doc.entries.map((e) => e.seq)).toEqual([0, 1]);
  });
});
