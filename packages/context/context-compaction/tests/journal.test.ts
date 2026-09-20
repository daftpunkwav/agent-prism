/**
 * @file journal test
 * @description Locks the append-only compaction journal and its guards.
 */
import { describe, expect, it } from "vitest";
import { buildCheckpoint } from "../src/checkpoint.js";
import { CompactionJournal } from "../src/journal.js";
import type { SurfaceFrame } from "../src/surface.js";

async function entry(at: number) {
  const frames: SurfaceFrame[] = [{ id: `f${at}`, role: "user", text: "question text here", weight: 1, compactable: true }];
  const checkpoint = await buildCheckpoint(frames);
  return {
    span: { start: 0, end: 0, tokens: 20, ids: [`f${at}`] },
    checkpoint,
    beforeTokens: 20,
    afterTokens: 8,
    at,
  };
}

describe("CompactionJournal", () => {
  it("appends in sequence and rejects gaps", async () => {
    const journal = new CompactionJournal();
    expect(journal.size).toBe(0);
    expect(journal.peek()).toBeUndefined();
    const first = journal.append(await entry(1));
    expect(first.seq).toBe(1);
    const gap = await entry(2);
    expect(() => journal.append({ ...gap, seq: 9 })).toThrow(/sequence gap/);
    journal.append(await entry(2));
    expect(journal.size).toBe(2);
    expect(journal.totalSaved()).toBe(24);
    expect(journal.audit()).toHaveLength(2);
    expect(journal.audit()[0]).toContain("#1");
    expect(journal.latestCheckpointText()).toContain("<compacted-summary>");
  });

  it("pops only the tail", async () => {
    const journal = new CompactionJournal();
    expect(journal.pop()).toBeUndefined();
    journal.append(await entry(1));
    journal.append(await entry(2));
    expect(journal.pop()?.seq).toBe(2);
    expect(journal.peek()?.seq).toBe(1);
    expect(journal.totalSaved()).toBe(12);
  });
});
