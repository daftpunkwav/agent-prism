/**
 * @file session-service tests
 * @description Locks SessionService orchestration over an ephemeral store.
 *
 * Responsibilities:
 * - Pin lifecycle delegation and the record-plus-entries detail view
 */

import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "@agentprism/session";
import { SessionService } from "@agentprism/application";

function testService() {
  let seq = 0;
  const store = new InMemorySessionStore({
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => 1700000000000 },
  });
  return new SessionService({ store });
}

describe("SessionService", () => {
  it("starts, notes, completes, and serves detail", async () => {
    const service = testService();
    const record = await service.startSession("arena", "run", { dimension: "framework" });
    await service.appendEntry(record.id, "lifecycle", "columns launched");
    const detail = await service.getSession(record.id);
    expect(detail?.record.title).toBe("run");
    expect(detail?.entries).toHaveLength(1);
    await service.completeSession(record.id, "all columns answered");
    expect((await service.getSession(record.id))?.record.status).toBe("completed");
  });

  it("serves spilled blobs and nulls missing or unsupported backends", async () => {
    const service = testService();
    const record = await service.startSession("agent", "run");
    const big = "v".repeat(9000);
    const entry = await service.appendEntry(record.id, "note", big);
    expect(entry.content).toMatch(/^\[ledger blob:/);
    expect(await service.readSessionBlob(record.id, entry.seq)).toBe(big);
    expect(await service.readSessionBlob(record.id, 99)).toBeNull();
    expect(await service.readSessionBlob("missing", 0)).toBeNull();
  });

  it("deletes records, false when unknown", async () => {
    const service = testService();
    const record = await service.startSession("arena", "doomed");
    expect(await service.deleteSession(record.id)).toBe(true);
    expect(await service.deleteSession(record.id)).toBe(false);
    expect(await service.getSession(record.id)).toBeNull();
  });

  it("batch-exports known ids and skips missing ones", async () => {
    const service = testService();
    const first = await service.startSession("agent", "one");
    const second = await service.startSession("arena", "two");
    const docs = await service.exportSessions([first.id, "missing", second.id]);
    expect(docs.map((d) => d.record.id).sort()).toEqual([first.id, second.id].sort());
    expect(docs[0]!.version).toBe(2);
  });

  it("returns null detail for unknown ids and filters listings", async () => {
    const service = testService();
    expect(await service.getSession("missing")).toBeNull();
    await service.startSession("agent", "a");
    const failed = await service.startSession("agent", "b");
    await service.failSession(failed.id, "timeout");
    expect(await service.listSessions({ kind: "agent", status: "failed" })).toHaveLength(1);
    expect(await service.listSessions({ status: "active" })).toHaveLength(1);
  });
});
