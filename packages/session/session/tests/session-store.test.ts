/**
 * @file session-store tests
 * @description Locks the SessionStore lifecycle contract on the memory backend.
 *
 * Responsibilities:
 * - Pin create/read/complete/fail/append/list/delete plus validation and caps
 */

import { describe, expect, it } from "vitest";
import { SessionNotFoundError, SessionValidationError } from "@agentprism/contracts";
import { InMemorySessionStore } from "../src/index.js";

function testStore() {
  let seq = 0;
  let now = 1700000000000;
  return new InMemorySessionStore({
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => now++ },
  });
}

describe("SessionStore lifecycle", () => {
  it("creates active sessions and reads them back", async () => {
    const store = testStore();
    const record = await store.create({ kind: "arena", title: "  hello  ", metadata: { dimension: "framework" } });
    expect(record.status).toBe("active");
    expect(record.title).toBe("hello");
    expect(record.summary).toBeNull();
    expect(record.entryCount).toBe(0);
    expect(await store.get(record.id)).toMatchObject({ id: record.id, title: "hello" });
    expect(await store.get("missing")).toBeNull();
  });

  it("rejects blank titles", async () => {
    const store = testStore();
    await expect(store.create({ kind: "agent", title: "   " })).rejects.toThrow(SessionValidationError);
  });

  it("completes with summary and merges metadata", async () => {
    const store = testStore();
    const created = await store.create({ kind: "arena", title: "bash", metadata: { a: 1 } });
    const done = await store.complete(created.id, { summary: "ok", metadata: { eventsYielded: 3 } });
    expect(done.status).toBe("completed");
    expect(done.summary).toBe("ok");
    expect(done.metadata).toMatchObject({ a: 1, eventsYielded: 3 });
  });

  it("fails with a reason and throws on unknown ids", async () => {
    const store = testStore();
    const created = await store.create({ kind: "agent", title: "bash" });
    const failed = await store.fail(created.id, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.summary).toBe("boom");
    await expect(store.complete("missing", {})).rejects.toThrow(SessionNotFoundError);
    await expect(store.fail("missing", "x")).rejects.toThrow(SessionNotFoundError);
    await expect(store.appendEntry("missing", { kind: "note", content: "x" })).rejects.toThrow(SessionNotFoundError);
    await expect(store.listEntries("missing")).rejects.toThrow(SessionNotFoundError);
  });

  it("appends sequenced entries newest-first with limits", async () => {
    const store = testStore();
    const created = await store.create({ kind: "builder", title: "s" });
    await store.appendEntry(created.id, { kind: "lifecycle", content: "first" });
    await store.appendEntry(created.id, { kind: "note", content: "second" });
    await expect(store.appendEntry(created.id, { kind: "note", content: "  " })).rejects.toThrow(SessionValidationError);
    const entries = await store.listEntries(created.id);
    expect(entries.map((e) => e.seq)).toEqual([1, 0]);
    expect(await store.listEntries(created.id, 1)).toHaveLength(1);
    expect((await store.get(created.id))?.entryCount).toBe(2);
  });

  it("serializes concurrent appends so each entry claims its own seq", async () => {
    const store = testStore();
    const created = await store.create({ kind: "agent", title: "race" });
    // Both calls read list.length before either pushes: the spill await always
    // yields, so without the per-session queue both would claim seq 0.
    const [first, second] = await Promise.all([
      store.appendEntry(created.id, { kind: "note", content: "a" }),
      store.appendEntry(created.id, { kind: "note", content: "b" }),
    ]);
    expect([first.seq, second.seq].sort((left, right) => left - right)).toEqual([0, 1]);
    const entries = await store.listEntries(created.id);
    expect(entries.map((entry) => entry.seq).sort((left, right) => left - right)).toEqual([0, 1]);
    expect((await store.get(created.id))?.entryCount).toBe(2);
  });

  it("queues delete behind a pending append so the append settles first", async () => {
    let releaseSpill = (): void => {};
    const spillGate = new Promise<void>((resolve) => {
      releaseSpill = resolve;
    });
    const calls: string[] = [];
    // Gate-controlled sidecar: the append suspends inside saveBlob until released,
    // which is the window a delete must not erase the session under.
    const blobs = {
      saveBlob: async () => {
        calls.push("save-start");
        await spillGate;
        calls.push("save-end");
      },
      loadBlob: async () => null,
      deleteSessionBlobs: async () => {
        calls.push("purge");
        return true;
      },
    };
    const store = new InMemorySessionStore({
      idGenerator: { next: () => "ses-race" },
      clock: { now: () => 1700000000000 },
      blobs,
    });
    const created = await store.create({ kind: "agent", title: "race" });
    // Oversized content spills to the sidecar, so the append yields inside saveBlob.
    const pending = store.appendEntry(created.id, { kind: "note", content: "x".repeat(9_000) });
    for (let tick = 0; tick < 500 && !calls.includes("save-start"); tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(calls).toContain("save-start");

    const deletion = store.delete(created.id);
    releaseSpill();
    await expect(pending).resolves.toMatchObject({ seq: 0 });
    await expect(deletion).resolves.toBe(true);
    // The purge runs after the spill landed, never before it: no orphan blob write
    // may trail a completed delete.
    expect(calls).toEqual(["save-start", "save-end", "purge"]);
    expect(await store.get(created.id)).toBeNull();
    await expect(store.listEntries(created.id)).rejects.toThrow(SessionNotFoundError);
    await expect(store.readBlob(created.id, 0)).resolves.toBeNull();
    await expect(store.delete(created.id)).resolves.toBe(false);
  });

  it("lists newest-first with kind/status/limit filters", async () => {
    const store = testStore();
    await store.create({ kind: "arena", title: "a1" });
    const second = await store.create({ kind: "agent", title: "a2" });
    await store.complete(second.id, {});
    expect((await store.list()).map((r) => r.title)).toEqual(["a2", "a1"]);
    expect(await store.list({ kind: "arena" })).toHaveLength(1);
    expect(await store.list({ status: "completed" })).toHaveLength(1);
    expect(await store.list({ limit: 1 })).toHaveLength(1);
    expect(await store.list({ limit: 0 })).toHaveLength(0);
  });

  it("cancels by requester with default reason", async () => {
    const store = testStore();
    const created = await store.create({ kind: "arena", title: "bash" });
    const cancelled = await store.cancel(created.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.summary).toBe("cancelled by client");
    await expect(store.cancel("missing")).rejects.toThrow(SessionNotFoundError);
  });

  it("deletes records plus entries, false when unknown", async () => {
    const store = testStore();
    const created = await store.create({ kind: "arena", title: "gone" });
    await store.appendEntry(created.id, { kind: "note", content: "x" });
    expect(await store.delete(created.id)).toBe(true);
    expect(await store.delete(created.id)).toBe(false);
    expect(await store.get(created.id)).toBeNull();
  });
});
