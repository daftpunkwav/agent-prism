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
    const created = await store.create({ kind: "arena", title: "run", metadata: { a: 1 } });
    const done = await store.complete(created.id, { summary: "ok", metadata: { eventsYielded: 3 } });
    expect(done.status).toBe("completed");
    expect(done.summary).toBe("ok");
    expect(done.metadata).toMatchObject({ a: 1, eventsYielded: 3 });
  });

  it("fails with a reason and throws on unknown ids", async () => {
    const store = testStore();
    const created = await store.create({ kind: "agent", title: "run" });
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
    const created = await store.create({ kind: "arena", title: "run" });
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
