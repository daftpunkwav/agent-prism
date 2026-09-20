/**
 * @file file-session-store tests
 * @description Locks file durability: round-trip, recovery, and stale-active handling.
 *
 * Responsibilities:
 * - Pin reload across instances, corrupt-file recovery, and active-to-failed on load
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AtomicJsonFile } from "@agentprism/persistence";
import { FileSessionStore } from "../src/index.js";

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-sessions-")), "sessions.json");
}

function testDeps(file: string) {
  let seq = 0;
  return { file: new AtomicJsonFile(file), idGenerator: { next: () => `ses-${++seq}` }, clock: { now: () => 1700000000000 } };
}

describe("FileSessionStore", () => {
  it("round-trips records plus entries across instances", async () => {
    const file = tempFile();
    const first = new FileSessionStore(testDeps(file));
    const created = await first.create({ kind: "arena", title: "run", metadata: { selections: 2 } });
    await first.appendEntry(created.id, { kind: "verdict", content: "column A wins" });
    await first.complete(created.id, { summary: "done" });

    const second = new FileSessionStore(testDeps(file));
    expect(await second.get(created.id)).toMatchObject({ title: "run", status: "completed", summary: "done" });
    expect(await second.listEntries(created.id)).toHaveLength(1);
    expect(await second.list({ kind: "arena" })).toHaveLength(1);
  });

  it("persists cancellation across instances", async () => {
    const file = tempFile();
    const first = new FileSessionStore(testDeps(file));
    const created = await first.create({ kind: "agent", title: "run" });
    await first.cancel(created.id, "user stop");
    const second = new FileSessionStore(testDeps(file));
    expect((await second.get(created.id))?.status).toBe("cancelled");
  });

  it("keeps valid sessions when a sibling record is corrupt", async () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const good = {
      record: {
        id: "ses-good",
        kind: "arena",
        title: "survivor",
        status: "completed",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        summary: null,
        metadata: {},
        entryCount: 0,
      },
      entries: [],
    };
    // One malformed sibling must not wipe the whole ledger (prior behavior
    // discarded every session, forcing operators to start over).
    const bad = { record: { id: "ses-bad", kind: "nope", title: 42 }, entries: "garbage" };
    fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [good, bad] }), "utf-8");
    const recovered = new FileSessionStore(testDeps(file));
    expect(await recovered.get("ses-good")).toMatchObject({ title: "survivor" });
    expect(await recovered.list()).toHaveLength(1);
  });

  it("recovers empty from corrupt files and marks stale active as failed", async () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json", "utf-8");
    const recovered = new FileSessionStore(testDeps(file));
    expect(await recovered.list()).toHaveLength(0);

    const created = await recovered.create({ kind: "agent", title: "orphan" });
    const reloaded = new FileSessionStore(testDeps(file));
    expect((await reloaded.get(created.id))?.status).toBe("failed");
  });
});
