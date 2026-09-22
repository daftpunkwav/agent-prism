/**
 * @file ledger-spill tests
 * @description Locks blob spill on durable backends: preview durability, restart reads, purge.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AtomicJsonFile, NodeAppendFile } from "@agentprism/persistence";
import { MAX_ENTRY_CONTENT_CHARS } from "@agentprism/session";
import { FileBlobStore, FileSessionStore, JsonlSessionStore } from "../src/index.js";

function fileDeps(dir: string) {
  let seq = 0;
  return {
    file: new AtomicJsonFile(path.join(dir, "sessions.json")),
    blobs: new FileBlobStore(path.join(dir, "sessions.json.blobs")),
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => 1700000000000 },
  };
}

function jsonlDeps(dir: string) {
  let seq = 0;
  return {
    log: new NodeAppendFile(path.join(dir, "sessions.jsonl")),
    snapshot: new AtomicJsonFile(path.join(dir, "snapshot.json")),
    blobs: new FileBlobStore(path.join(dir, "sessions.jsonl.blobs")),
    idGenerator: { next: () => `ses-${++seq}` },
    clock: { now: () => 1700000000000 },
  };
}

const BIG = `HEAD-${"a".repeat(4000)}\n${"m".repeat(9000)}\n${"z".repeat(3995)}TAIL`;
if (BIG.length <= MAX_ENTRY_CONTENT_CHARS) throw new Error("fixture too small");

describe("FileSessionStore ledger spill", () => {
  it("persists previews and serves blobs across restarts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-"));
    try {
      const first = new FileSessionStore(fileDeps(dir));
      const record = await first.create({ kind: "agent", title: "bash" });
      const entry = await first.appendEntry(record.id, { kind: "note", content: BIG });
      expect(entry.content).toMatch(/^\[ledger blob:/);
      expect(fs.existsSync(path.join(dir, "sessions.json.blobs"))).toBe(true);

      const second = new FileSessionStore(fileDeps(dir));
      const entries = await second.listEntries(record.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.content).toMatch(/^\[ledger blob:/);
      expect(await second.readBlob(record.id, 0)).toBe(BIG);
      expect(await second.readBlob(record.id, 7)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("purges blob files on delete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-"));
    try {
      const store = new FileSessionStore(fileDeps(dir));
      const record = await store.create({ kind: "agent", title: "bash" });
      await store.appendEntry(record.id, { kind: "note", content: BIG });
      expect(await store.delete(record.id)).toBe(true);
      expect(fs.readdirSync(path.join(dir, "sessions.json.blobs"))).toHaveLength(0);
      expect(await store.readBlob(record.id, 0)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to ephemeral memory blobs without a sidecar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-"));
    try {
      const deps = fileDeps(dir);
      const store = new FileSessionStore({ file: deps.file, idGenerator: deps.idGenerator, clock: deps.clock });
      const record = await store.create({ kind: "agent", title: "bash" });
      const entry = await store.appendEntry(record.id, { kind: "note", content: BIG });
      expect(entry.content).toMatch(/^\[ledger blob:/);
      expect(await store.readBlob(record.id, entry.seq)).toBe(BIG);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("JsonlSessionStore ledger spill", () => {
  it("keeps previews through checkpoints and serves blobs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-"));
    try {
      const first = new JsonlSessionStore(jsonlDeps(dir));
      const record = await first.create({ kind: "agent", title: "bash" });
      await first.appendEntry(record.id, { kind: "note", content: BIG });
      await first.checkpoint();

      const second = new JsonlSessionStore(jsonlDeps(dir));
      const entries = await second.listEntries(record.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.content).toMatch(/^\[ledger blob:/);
      expect(await second.readBlob(record.id, 0)).toBe(BIG);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("purges blobs on delete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-"));
    try {
      const store = new JsonlSessionStore(jsonlDeps(dir));
      const record = await store.create({ kind: "agent", title: "bash" });
      await store.appendEntry(record.id, { kind: "note", content: BIG });
      expect(await store.delete(record.id)).toBe(true);
      expect(fs.readdirSync(path.join(dir, "sessions.jsonl.blobs"))).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
