/**
 * @file validate test
 * @description Locks document validation defect taxonomy.
 */
import { describe, expect, it } from "vitest";
import { migrateToV2 } from "../src/migrate.js";
import { validateSessionDocument } from "../src/validate.js";

function valid() {
  return migrateToV2({
    record: { id: "s1", kind: "agent", title: "t", status: "completed", createdAt: 1, updatedAt: 2, summary: "done", metadata: { n: 1 }, entryCount: 1 },
    entries: [{ sessionId: "s1", seq: 0, at: 1, kind: "verdict", content: "pass" }],
  });
}

describe("validateSessionDocument", () => {
  it("accepts clean documents", () => {
    expect(validateSessionDocument(valid())).toEqual({ valid: true, defects: [] });
  });

  it("collects every defect class in one pass", () => {
    const doc = valid() as unknown as Record<string, unknown>;
    const record = { ...(doc.record as Record<string, unknown>), title: "  ", status: "weird" };
    const entries = [
      { sessionId: "s1", seq: 0, at: 1, kind: "lifecycle", content: "ok" },
      { sessionId: "s1", seq: 0, at: 2, kind: "lifecycle", content: "dup" },
      { sessionId: "s1", seq: 2, at: 3, kind: "note", content: 7 },
    ];
    const verdict = validateSessionDocument({ version: 2, record, entries });
    expect(verdict.valid).toBe(false);
    const codes = verdict.defects.map((d) => d.code);
    expect(codes).toContain("record");
    expect(codes).toContain("seq");
    expect(codes).toContain("content");
  });

  it("rejects wrong versions without further checks", () => {
    const verdict = validateSessionDocument({ version: 1, record: {}, entries: [] });
    expect(verdict).toMatchObject({ valid: false, defects: [{ code: "version", message: expect.any(String) }] });
  });
});
