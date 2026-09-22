/**
 * @file blob-store tests
 * @description Locks ledger persist-then-prune: passthrough, spill shape, caps, loud degradation.
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryBlobStore,
  InMemorySessionStore,
  LEDGER_BLOB_MAX_CHARS,
  MAX_ENTRY_CONTENT_CHARS,
  formatSpilledEntry,
  spillOversizedEntry,
} from "../src/index.js";

function testStore(blobs = new InMemoryBlobStore()) {
  let seq = 0;
  let now = 1700000000000;
  return new InMemorySessionStore({
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => now++ },
    blobs,
  });
}

describe("InMemoryBlobStore", () => {
  it("round-trips blobs and purges per session", async () => {
    const blobs = new InMemoryBlobStore();
    await blobs.saveBlob("s1", 0, "full text");
    await blobs.saveBlob("s1", 1, "more");
    await blobs.saveBlob("s2", 0, "other");
    expect(await blobs.loadBlob("s1", 0)).toBe("full text");
    expect(await blobs.loadBlob("s1", 9)).toBeNull();
    expect(await blobs.deleteSessionBlobs("s1")).toBe(true);
    expect(await blobs.loadBlob("s1", 0)).toBeNull();
    expect(await blobs.loadBlob("s2", 0)).toBe("other");
    expect(await blobs.deleteSessionBlobs("s1")).toBe(false);
  });
});

describe("spillOversizedEntry", () => {
  it("passes small contents through unchanged", async () => {
    const blobs = new InMemoryBlobStore();
    expect(await spillOversizedEntry(blobs, "s1", 0, "hello")).toBe("hello");
    expect(await blobs.loadBlob("s1", 0)).toBeNull();
  });

  it("spills locator-first with head and tail around a count marker", async () => {
    const blobs = new InMemoryBlobStore();
    const big = `HEAD-${"a".repeat(4000)}\n${"m".repeat(9000)}\n${"z".repeat(3995)}TAIL`;
    if (big.length <= MAX_ENTRY_CONTENT_CHARS) throw new Error("fixture too small");
    const stored = await spillOversizedEntry(blobs, "s1", 3, big);
    expect(stored).toMatch(/^\[ledger blob: \d+ chars — full text via session_query action=read_entry id=s1 seq=3\]/);
    expect(stored.length).toBeLessThan(MAX_ENTRY_CONTENT_CHARS);
    expect(stored).toContain("HEAD-aaa");
    expect(stored).toContain("zzzzzTAIL");
    expect(stored).toMatch(/middle spilled: \d+ chars total/);
    expect(await blobs.loadBlob("s1", 3)).toBe(big);
  });

  it("caps per-blob bodies loudly", async () => {
    const blobs = new InMemoryBlobStore();
    const huge = "q".repeat(LEDGER_BLOB_MAX_CHARS + 100);
    const stored = await spillOversizedEntry(blobs, "s1", 0, huge);
    const blob = await blobs.loadBlob("s1", 0);
    expect(blob).toContain("(ledger blob capped");
    expect(blob?.length).toBeLessThan(huge.length);
    expect(stored).toContain("[ledger blob:");
  });

  it("degrades to a loud head cut when the save fails", async () => {
    const broken = {
      saveBlob: async () => {
        throw new Error("disk gone");
      },
      loadBlob: async () => null,
      deleteSessionBlobs: async () => false,
    };
    const stored = await spillOversizedEntry(broken, "s1", 0, "w".repeat(MAX_ENTRY_CONTENT_CHARS + 10));
    expect(stored).toContain("(ledger blob failed: disk gone)");
    expect(stored.length).toBeLessThanOrEqual(MAX_ENTRY_CONTENT_CHARS + 100);
  });
});

describe("memory store ledger spill wiring", () => {
  it("stores previews and serves full text via readBlob", async () => {
    const store = testStore();
    const record = await store.create({ kind: "agent", title: "bash" });
    const big = "v".repeat(MAX_ENTRY_CONTENT_CHARS + 500);
    const entry = await store.appendEntry(record.id, { kind: "note", content: big });
    expect(entry.content).toMatch(/^\[ledger blob:/);
    expect(entry.content.length).toBeLessThan(MAX_ENTRY_CONTENT_CHARS);
    expect(await store.readBlob(record.id, entry.seq)).toBe(big);
    expect(await store.readBlob(record.id, 99)).toBeNull();
    expect(await store.readBlob("missing", 0)).toBeNull();
  });

  it("keeps small entries inline with no blob", async () => {
    const store = testStore();
    const record = await store.create({ kind: "agent", title: "bash" });
    const entry = await store.appendEntry(record.id, { kind: "note", content: "small" });
    expect(entry.content).toBe("small");
    expect(await store.readBlob(record.id, entry.seq)).toBeNull();
  });

  it("purges blobs on delete", async () => {
    const blobs = new InMemoryBlobStore();
    const store = testStore(blobs);
    const record = await store.create({ kind: "agent", title: "bash" });
    await store.appendEntry(record.id, { kind: "note", content: "v".repeat(MAX_ENTRY_CONTENT_CHARS + 10) });
    expect(await store.delete(record.id)).toBe(true);
    expect(await blobs.loadBlob(record.id, 0)).toBeNull();
  });

  it("formatSpilledEntry stays bounded for short oversized margins", () => {
    const content = "x".repeat(MAX_ENTRY_CONTENT_CHARS + 1);
    expect(formatSpilledEntry(content, "s", 0).length).toBeLessThan(MAX_ENTRY_CONTENT_CHARS);
  });
});
