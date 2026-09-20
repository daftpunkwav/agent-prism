/**
 * @file envelope-migrate test
 * @description Locks envelope detection, v1→v2 migration, and fail-loud versions.
 */
import { describe, expect, it } from "vitest";
import { detectEnvelopeVersion, sessionFilename } from "../src/envelope.js";
import { migrateToV2 } from "../src/migrate.js";

describe("sessionFilename", () => {
  it("maps safe ids and rejects traversal", () => {
    expect(sessionFilename("abc-123")).toBe("abc-123.session.json");
    for (const bad of ["", "../x", "/abs", "a/b", "a\\b", "has space", ".", ".."]) {
      expect(() => sessionFilename(bad)).toThrow();
    }
  });
});

describe("migrateToV2", () => {
  const v1 = {
    record: { id: "s1", kind: "arena", title: "t", status: "active", createdAt: 10, updatedAt: 12 },
    entries: [
      { sessionId: "s1", seq: 0, at: 11, kind: "lifecycle", content: "started" },
      { sessionId: "s1", seq: 1, at: 12, kind: "bogus", content: 42 },
    ],
  };
  it("upgrades v1 with backfills and coercions", () => {
    const doc = migrateToV2(v1);
    expect(doc.version).toBe(2);
    expect(doc.record.summary).toBeNull();
    expect(doc.record.metadata).toEqual({});
    expect(doc.record.entryCount).toBe(2);
    expect(doc.entries[1]).toMatchObject({ kind: "lifecycle", content: "" });
    expect(detectEnvelopeVersion(v1)).toBe(1);
    expect(detectEnvelopeVersion(doc)).toBe(2);
  });

  it("passes v2 through and rejects unknown/newer shapes", () => {
    const v2 = migrateToV2(v1);
    expect(migrateToV2(JSON.parse(JSON.stringify(v2))).version).toBe(2);
    expect(() => migrateToV2({ version: 99, record: {}, entries: [] })).toThrow(/newer version/);
    expect(() => migrateToV2(null)).toThrow();
    expect(() => migrateToV2({ record: {} })).toThrow();
    expect(detectEnvelopeVersion(null)).toBeNull();
  });
});
