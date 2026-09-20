/**
 * @file projection-cache test
 * @description Locks digest views, windows, rollups, and cache behavior.
 */
import { describe, expect, it } from "vitest";
import { ProjectionCache, digestFor } from "../src/cache.js";
import { projectDigest, projectEntryWindow, rollupVerdicts } from "../src/projection.js";
import type { SessionDocumentV2 } from "@agentprism/session-format";
import type { SessionEntry } from "@agentprism/contracts";

function doc(): SessionDocumentV2 {
  const entries: SessionEntry[] = [
    { sessionId: "s1", seq: 0, at: 10, kind: "lifecycle", content: "started" },
    { sessionId: "s1", seq: 1, at: 20, kind: "verdict", content: "PASS: all green" },
    { sessionId: "s1", seq: 2, at: 30, kind: "note", content: "remember this" },
    { sessionId: "s1", seq: 3, at: 40, kind: "verdict", content: "FAIL: flaky bit" },
  ];
  return {
    version: 2,
    record: { id: "s1", kind: "arena", title: "race", status: "completed", createdAt: 1, updatedAt: 40, summary: "done", metadata: {}, entryCount: 4 },
    entries,
  };
}

describe("projections", () => {
  it("digests rows, windows, and verdict rollups", () => {
    const document = doc();
    expect(projectDigest(document)).toMatchObject({ id: "s1", entryCount: 4, verdicts: 2, lastEntryAt: 40 });
    const window = projectEntryWindow("s1", document.entries, { limit: 2 });
    expect(window.entries.map((e) => e.seq)).toEqual([3, 2]);
    expect(window.total).toBe(4);
    expect(rollupVerdicts("s1", document.entries)).toMatchObject({ passed: 1, failed: 1, notes: 1, latest: "FAIL: flaky bit" });
    expect(projectEntryWindow("s1", []).total).toBe(0);
  });
});

describe("ProjectionCache", () => {
  it("hits on digest match and recomputes on change", () => {
    const cache = new ProjectionCache();
    const document = doc();
    const first = cache.view("s1", digestFor(40, 4), document);
    expect(cache.missCount()).toBe(1);
    expect(cache.view("s1", digestFor(40, 4), document)).toBe(first);
    expect(cache.hitCount()).toBe(1);
    const changed = cache.view("s1", digestFor(50, 5), document);
    expect(changed).not.toBe(first);
    expect(changed.digest).toBe("50:5");
    expect(cache.size).toBe(1);
    expect(cache.invalidate("s1")).toBe(true);
    expect(cache.invalidate("s1")).toBe(false);
    cache.clear();
    expect(cache.hitCount()).toBe(0);
  });
});
