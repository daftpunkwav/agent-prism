/**
 * @file jsonl-store test
 * @description Locks JSONL backend parity with the single-doc store plus crash posture.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeAppendFile } from "@agentprism/persistence";
import { AtomicJsonFile } from "@agentprism/persistence";
import { RandomIdGenerator, SystemClock } from "@agentprism/runtime";
import { JsonlSessionStore } from "../src/jsonl-session-store.js";

function backend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-jsonl-"));
  return {
    dir,
    store: () =>
      new JsonlSessionStore({
        log: new NodeAppendFile(path.join(dir, "sessions.jsonl")),
        snapshot: new AtomicJsonFile(path.join(dir, "snapshot.json")),
        idGenerator: new RandomIdGenerator(),
        clock: new SystemClock(),
      }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("JsonlSessionStore", () => {
  it("runs the full lifecycle and survives reload via replay", async () => {
    const { dir, store, cleanup } = backend();
    try {
      const first = store();
      const record = await first.create({ kind: "arena", title: "race" });
      await first.appendEntry(record.id, { kind: "note", content: "hello" });
      await first.complete(record.id, { summary: "done" });
      expect((await first.get(record.id))?.status).toBe("completed");

      const second = store();
      expect(second.corruptLines()).toBe(0);
      const reloaded = await second.get(record.id);
      expect(reloaded?.summary).toBe("done");
      expect(reloaded?.entryCount).toBe(1);
      expect(await second.listEntries(record.id)).toHaveLength(1);
      expect(fs.existsSync(path.join(dir, "sessions.jsonl"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("compacts the log into a snapshot and skips corrupt lines loudly", async () => {
    const { dir, store, cleanup } = backend();
    try {
      const first = store();
      const record = await first.create({ kind: "agent", title: "job" });
      await first.appendEntry(record.id, { kind: "lifecycle", content: "step" });
      const stats = await first.checkpoint();
      expect(stats).toMatchObject({ sessions: 1, entries: 1 });
      expect(fs.readFileSync(path.join(dir, "sessions.jsonl"), "utf-8")).toBe("");

      fs.appendFileSync(path.join(dir, "sessions.jsonl"), "not json\n");
      const second = store();
      await second.list();
      expect(second.corruptLines()).toBe(1);
      expect((await second.get(record.id))?.title).toBe("job");
    } finally {
      cleanup();
    }
  });

  it("migrates stale active rows to failed on load like the doc backend", async () => {
    const { store, cleanup } = backend();
    try {
      const first = store();
      const record = await first.create({ kind: "builder", title: "hangs" });
      const second = store();
      expect((await second.get(record.id))?.status).toBe("failed");
    } finally {
      cleanup();
    }
  });
});
