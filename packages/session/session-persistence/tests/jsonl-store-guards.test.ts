/**
 * @file jsonl session store guards tests
 * @description Locks the JSONL backend's validation, filtering, blob, and
 *              corrupt-file recovery paths.
 *
 * Responsibilities:
 * - Pin entry validation (empty content, per-session entry cap) and ordering
 * - Pin listing filters and the delete contract, including blob cleanup
 * - Pin recovery: an unreadable or schema-mismatched snapshot falls back to the log
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtomicJsonFile, NodeAppendFile } from "@agentprism/persistence";
import { RandomIdGenerator, SystemClock } from "@agentprism/runtime";
import { MAX_ENTRIES_PER_SESSION } from "@agentprism/session";
import { FileBlobStore } from "../src/file-blob-store.js";
import { JsonlSessionStore } from "../src/jsonl-session-store.js";

function backend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-jsonl-guards-"));
  return {
    dir,
    store: () =>
      new JsonlSessionStore({
        log: new NodeAppendFile(path.join(dir, "sessions.jsonl")),
        snapshot: new AtomicJsonFile(path.join(dir, "snapshot.json")),
        blobs: new FileBlobStore(path.join(dir, "blobs")),
        idGenerator: new RandomIdGenerator(),
        clock: new SystemClock(),
      }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("JsonlSessionStore entry guards", () => {
  it("rejects empty entry content and accepts trimmed content", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const record = await target.create({ kind: "agent", title: "guards" });
      await expect(target.appendEntry(record.id, { kind: "note", content: "   " })).rejects.toThrow(
        /content must be non-empty/,
      );
      const entry = await target.appendEntry(record.id, { kind: "note", content: "  kept  " });
      expect(entry.content).toBe("kept");
    } finally {
      cleanup();
    }
  });

  it("refuses to exceed the per-session entry cap", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const record = await target.create({ kind: "agent", title: "cap" });
      // Filling the cap entry by entry is slow; the guard is the last entry over it.
      const list = Array.from({ length: MAX_ENTRIES_PER_SESSION }, (_v, i) => i);
      for (const index of list) {
        await target.appendEntry(record.id, { kind: "note", content: `entry ${index}` });
      }
      await expect(target.appendEntry(record.id, { kind: "note", content: "over" })).rejects.toThrow(/cap of/);
    } finally {
      cleanup();
    }
  }, 60_000);

  it("returns entries newest first and honours a limit", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const record = await target.create({ kind: "agent", title: "order" });
      await target.appendEntry(record.id, { kind: "note", content: "first" });
      await target.appendEntry(record.id, { kind: "note", content: "second" });
      await target.appendEntry(record.id, { kind: "note", content: "third" });

      expect((await target.listEntries(record.id)).map((entry) => entry.content)).toEqual(["third", "second", "first"]);
      expect((await target.listEntries(record.id, 2)).map((entry) => entry.content)).toEqual(["third", "second"]);
      expect((await target.listEntries(record.id, 0))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("appends to an unknown session with a not-found error", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      await expect(target.appendEntry("missing", { kind: "note", content: "x" })).rejects.toThrow(/Unknown session/);
    } finally {
      cleanup();
    }
  });
});

describe("JsonlSessionStore listing and deletion", () => {
  it("filters listings by kind and status", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const arena = await target.create({ kind: "arena", title: "arena run" });
      const agent = await target.create({ kind: "agent", title: "agent run" });
      await target.complete(agent.id, { summary: "done" });

      expect((await target.list({ kind: "arena" })).map((record) => record.id)).toEqual([arena.id]);
      expect((await target.list({ status: "completed" })).map((record) => record.id)).toEqual([agent.id]);
      expect((await target.list({ kind: "agent", status: "active" }))).toEqual([]);
      expect((await target.list()).length).toBe(2);
      expect((await target.list({ limit: 1 })).length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("deletes a session, purges its blobs, and reports unknown ids as false", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const record = await target.create({ kind: "agent", title: "delete me" });
      await target.appendEntry(record.id, { kind: "note", content: "x".repeat(9000) });
      const entries = await target.listEntries(record.id);
      expect(entries[0]?.content).toMatch(/^\[ledger blob:/);

      expect(await target.delete(record.id)).toBe(true);
      expect(await target.get(record.id)).toBeNull();
      expect(await target.readBlob(record.id, 0)).toBeNull();
      expect(await target.delete(record.id)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("serves spilled entry text through readBlob and null elsewhere", async () => {
    const { store, cleanup } = backend();
    try {
      const target = store();
      const record = await target.create({ kind: "agent", title: "blobs" });
      const body = `HEAD${"m".repeat(9000)}TAIL`;
      await target.appendEntry(record.id, { kind: "note", content: body });

      const full = await target.readBlob(record.id, 0);
      expect(full).toBe(body);
      // Unknown sequences and unknown sessions resolve to null, never a throw.
      expect(await target.readBlob(record.id, 99)).toBeNull();
      expect(await target.readBlob("missing", 0)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("JsonlSessionStore recovery", () => {
  it("replays the log when the snapshot is unreadable", async () => {
    const { dir, store, cleanup } = backend();
    try {
      const first = store();
      const record = await first.create({ kind: "agent", title: "recovery" });
      await first.appendEntry(record.id, { kind: "note", content: "from the log" });

      // Corrupt the snapshot: the log alone must still produce the state.
      fs.writeFileSync(path.join(dir, "snapshot.json"), "{not json", "utf-8");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const second = store();
      expect((await second.get(record.id))?.title).toBe("recovery");
      expect((await second.listEntries(record.id)).map((entry) => entry.content)).toEqual(["from the log"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("snapshot unreadable"));
      warn.mockRestore();
    } finally {
      cleanup();
    }
  });

  it("replays the log when the snapshot fails its schema", async () => {
    const { dir, store, cleanup } = backend();
    try {
      const first = store();
      const record = await first.create({ kind: "agent", title: "schema" });
      // A structurally valid JSON document with the wrong shape.
      fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify({ version: 2, sessions: [] }), "utf-8");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const second = store();
      expect((await second.get(record.id))?.title).toBe("schema");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("snapshot schema mismatch"));
      warn.mockRestore();
    } finally {
      cleanup();
    }
  });

  it("counts corrupt log lines and keeps the rest of the record", async () => {
    const { dir, store, cleanup } = backend();
    try {
      const logPath = path.join(dir, "sessions.jsonl");
      const first = store();
      const record = await first.create({ kind: "agent", title: "corrupt tail" });
      fs.appendFileSync(logPath, "{definitely not json}\n", "utf-8");

      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const second = store();
      // Loading is lazy: the first read triggers the replay that counts the bad line.
      expect((await second.get(record.id))?.title).toBe("corrupt tail");
      expect(second.corruptLines()).toBe(1);
      warn.mockRestore();
    } finally {
      cleanup();
    }
  });
});
