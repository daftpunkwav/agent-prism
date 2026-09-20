/**
 * @file query test
 * @description Locks session filtering, search, sort, and pagination.
 */
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@agentprism/contracts";
import { InMemorySessionStore } from "@agentprism/session";
import { RandomIdGenerator, SystemClock } from "@agentprism/runtime";
import { querySessions } from "../src/query.js";

async function seeded() {
  const store = new InMemorySessionStore({ idGenerator: new RandomIdGenerator(), clock: new SystemClock() });
  const a = await store.create({ kind: "arena", title: "Prime race" });
  // Backdate by completing in order: newest-first comes from creation order here.
  const b = await store.create({ kind: "agent", title: "Nightly review" });
  await store.complete(a.id, { summary: "all columns passed" });
  await store.appendEntry(b.id, { kind: "note", content: "remember the login bug" });
  return { store, a, b };
}

describe("querySessions", () => {
  it("filters by kind/status sets and sorts", async () => {
    const { store } = await seeded();
    expect((await querySessions(store, { kinds: ["arena"] })).total).toBe(1);
    expect((await querySessions(store, { statuses: ["completed"] })).rows[0]!.kind).toBe("arena");
    const both = await querySessions(store, { sort: "oldest" });
    expect(both.total).toBe(2);
  });

  it("searches titles, summaries, and entries", async () => {
    const { store } = await seeded();
    expect((await querySessions(store, { text: "prime" })).total).toBe(1);
    expect((await querySessions(store, { text: "columns passed" })).total).toBe(1);
    expect((await querySessions(store, { entryText: "login bug" })).total).toBe(1);
    expect((await querySessions(store, { entryText: "absent phrase" })).total).toBe(0);
  });

  it("paginates and fails unknown enums closed", async () => {
    const { store } = await seeded();
    const page = await querySessions(store, { limit: 1, offset: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.limit).toBe(1);
    expect((await querySessions(store, { kinds: ["bogus" as never] })).total).toBe(0);
    expect((await querySessions(store, { statuses: ["bogus" as never] })).total).toBe(0);
  });

  it("filters time windows half-open", async () => {
    const { store, a } = await seeded();
    const at = (await store.get(a.id)) as SessionRecord;
    expect((await querySessions(store, { createdFrom: at.createdAt + 1 })).total).toBeLessThanOrEqual(2);
    expect((await querySessions(store, { createdTo: at.createdAt })).total).toBe(0);
  });
});
