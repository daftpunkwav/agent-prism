/**
 * @file session append concurrency tests
 * @description Locks per-session mutation ordering on both durable backends.
 *
 * Responsibilities:
 * - Pin that concurrent appends get distinct, gapless sequence numbers
 * - Pin that the whole-ledger backend does not let an older snapshot overwrite
 *   a newer one
 * - Pin that a mutation racing a checkpoint is never lost (snapshot + log truncate
 *   must not swallow an append the caller was told succeeded)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AtomicJsonFile, NodeAppendFile } from "@agentprism/persistence";
import { FileSessionStore, JsonlSessionStore } from "../src/index.js";

function fileDeps(dir: string) {
  let seq = 0;
  return {
    file: new AtomicJsonFile(path.join(dir, "sessions.json")),
    // A slow write widens the window in which a racing flush could land late.
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => 1700000000000 },
  };
}

function jsonlDeps(dir: string) {
  let seq = 0;
  return {
    log: new NodeAppendFile(path.join(dir, "sessions.jsonl")),
    snapshot: new AtomicJsonFile(path.join(dir, "snapshot.json")),
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => 1700000000000 },
  };
}

describe("concurrent appendEntry", () => {
  it("assigns distinct sequential seq values on the JSONL backend", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-seq-jsonl-"));
    try {
      const store = new JsonlSessionStore(jsonlDeps(dir));
      const record = await store.create({ kind: "arena", title: "col" });
      // Seven columns appending lifecycle milestones at once: before the queue
      // they all read the same list length and claimed the same seq.
      const entries = await Promise.all(
        Array.from({ length: 7 }, (_unused, index) =>
          store.appendEntry(record.id, { kind: "note", content: `entry ${index}` }),
        ),
      );
      expect(entries.map((entry) => entry.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      const listed = await store.listEntries(record.id);
      expect(listed).toHaveLength(7);
      expect(new Set(listed.map((entry) => entry.seq)).size).toBe(7);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not lose an append that races a checkpoint", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-checkpoint-race-"));
    try {
      const store = new JsonlSessionStore(jsonlDeps(dir));
      const record = await store.create({ kind: "arena", title: "col" });
      // Start a checkpoint and an append in the same tick: without a shared critical
      // section the append's log line can be truncated away while the snapshot was
      // taken before its state change, and the caller still sees success.
      const [stats, entry] = await Promise.all([
        store.checkpoint(),
        store.appendEntry(record.id, { kind: "note", content: "arrived during checkpoint" }),
      ]);
      expect(stats.sessions).toBeGreaterThanOrEqual(1);
      expect(entry.seq).toBeGreaterThanOrEqual(0);

      // Reload from disk: the append must survive (snapshot or replay).
      const reloaded = new JsonlSessionStore(jsonlDeps(dir));
      const listed = await reloaded.listEntries(record.id);
      expect(listed.map((item) => item.content)).toContain("arrived during checkpoint");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("assigns distinct sequential seq values on the ledger backend", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-seq-file-"));
    try {
      const store = new FileSessionStore(fileDeps(dir));
      const record = await store.create({ kind: "arena", title: "col" });
      const entries = await Promise.all(
        Array.from({ length: 5 }, (_unused, index) =>
          store.appendEntry(record.id, { kind: "note", content: `entry ${index}` }),
        ),
      );
      expect(entries.map((entry) => entry.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
      // Reload from disk: the persisted document must agree with the in-memory bookkeeping.
      const reloaded = new FileSessionStore(fileDeps(dir));
      const listed = await reloaded.listEntries(record.id);
      expect(listed.map((entry) => entry.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
