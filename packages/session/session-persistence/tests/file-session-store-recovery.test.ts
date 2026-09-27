/**
 * @file file session store recovery tests
 * @description Locks the ledger backend's load-side tolerance and write-side
 *              validation: what survives a hand-grown file, what a stale run
 *              comes back as, and which inputs are refused.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtomicJsonFile } from "@agentprism/persistence";
import { RandomIdGenerator, SystemClock } from "@agentprism/runtime";
import { MAX_ENTRIES_PER_SESSION, MAX_SESSIONS_PER_STORE, MAX_SUMMARY_CHARS } from "@agentprism/session";
import { FileSessionStore } from "../src/file-session-store.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ledger-recovery-"));
}

function storeOver(dir: string): FileSessionStore {
  return new FileSessionStore({
    file: new AtomicJsonFile(path.join(dir, "sessions.json")),
    idGenerator: new RandomIdGenerator(),
    clock: new SystemClock(),
  });
}

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "agent",
    title: `title ${id}`,
    status: "completed",
    createdAt: 1_000,
    updatedAt: 2_000,
    summary: null,
    metadata: {},
    entryCount: 0,
    ...overrides,
  };
}

describe("FileSessionStore load tolerance", () => {
  it("starts empty when the file is unreadable and warns", () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.mkdirSync(path.join(dir, "sessions.json"), { recursive: true });
      const store = storeOver(dir);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("session file unreadable"));
      expect(store.list({})).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts empty when the sessions field is not an array", () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(dir, "sessions.json"), JSON.stringify({ version: 1, sessions: "nope" }), "utf-8");
      const store = storeOver(dir);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("schema mismatch"));
      expect(store.list({})).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the well-formed records of a partially corrupt file", () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(
        path.join(dir, "sessions.json"),
        JSON.stringify({
          // The wrong version fails the strict schema and falls back to per-item parsing.
          version: 2,
          sessions: [{ record: record("s-good"), entries: [] }, { record: { id: "s-bad" }, entries: [] }, "junk"],
        }),
        "utf-8",
      );
      const store = storeOver(dir);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("kept 1, dropped 2"));
      return expect(store.get("s-good")).resolves.toMatchObject({ id: "s-good" }).then(async () => {
        await expect(store.get("s-bad")).resolves.toBeNull();
      });
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates stale active rows to failed and renumbers entries by position", async () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(
        path.join(dir, "sessions.json"),
        JSON.stringify({
          version: 1,
          sessions: [
            {
              record: record("s-active", { status: "active" }),
              entries: [
                { sessionId: "s-active", seq: 7, at: 1, kind: "note", content: "first" },
                { sessionId: "s-active", seq: 9, at: 2, kind: "verdict", content: "second" },
                // An entry belonging to another session is dropped, not rehomed.
                { sessionId: "s-other", seq: 0, at: 3, kind: "note", content: "foreign" },
              ],
            },
          ],
        }),
        "utf-8",
      );
      const store = storeOver(dir);
      const loaded = await store.get("s-active");
      expect(loaded).toMatchObject({ status: "failed", entryCount: 2 });
      const entries = await store.listEntries("s-active");
      expect(entries.map((entry) => [entry.seq, entry.content])).toEqual([
        [1, "second"],
        [0, "first"],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("truncates an over-grown ledger to the caps on load", async () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(
        path.join(dir, "sessions.json"),
        JSON.stringify({
          version: 1,
          sessions: [
            {
              record: record("s-0"),
              entries: Array.from({ length: MAX_ENTRIES_PER_SESSION + 3 }, (_v, i) => ({
                sessionId: "s-0",
                seq: i,
                at: 1_000 + i,
                kind: "note",
                content: `entry ${i}`,
              })),
            },
            ...Array.from({ length: MAX_SESSIONS_PER_STORE }, (_v, i) => ({ record: record(`s-extra-${i}`), entries: [] })),
          ],
        }),
        "utf-8",
      );
      const store = storeOver(dir);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("loading the first"));
      expect(await store.list({})).toHaveLength(MAX_SESSIONS_PER_STORE);
      expect(await store.listEntries("s-0")).toHaveLength(MAX_ENTRIES_PER_SESSION);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FileSessionStore validation and lifecycle", () => {
  it("rejects a blank title and an unknown session id", async () => {
    const dir = tempDir();
    try {
      const store = storeOver(dir);
      await expect(store.create({ kind: "agent", title: "   " })).rejects.toThrow(/title must be non-empty/);
      await expect(store.fail("s-missing", "boom")).rejects.toThrow(/s-missing/);
      await expect(store.cancel("s-missing")).rejects.toThrow(/s-missing/);
      await expect(store.appendEntry("s-missing", { kind: "note", content: "x" })).rejects.toThrow(/s-missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records failure and cancellation with a capped reason", async () => {
    const dir = tempDir();
    try {
      const store = storeOver(dir);
      const failing = await store.create({ kind: "agent", title: "fails" });
      const failed = await store.fail(failing.id, "  provider refused  ");
      expect(failed).toMatchObject({ status: "failed", summary: "provider refused" });

      const cancelling = await store.create({ kind: "agent", title: "cancels" });
      expect(await store.cancel(cancelling.id, "long reason ".repeat(200))).toMatchObject({ status: "cancelled" });
      const longReason = (await store.get(cancelling.id))?.summary ?? "";
      expect(longReason.length).toBe(MAX_SUMMARY_CHARS);

      // Both states survive a reload through the file.
      const reloaded = storeOver(dir);
      await expect(reloaded.get(failing.id)).resolves.toMatchObject({ status: "failed" });
      await expect(reloaded.get(cancelling.id)).resolves.toMatchObject({ status: "cancelled" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges a completion summary and metadata, then lists by filter and limit", async () => {
    const dir = tempDir();
    try {
      const store = storeOver(dir);
      const first = await store.create({ kind: "agent", title: "first" });
      const second = await store.create({ kind: "arena", title: "second" });
      await store.complete(second.id, { summary: "  done  ", metadata: { tokens: 5 } });
      await store.complete(first.id, { summary: "" });

      await expect(store.get(second.id)).resolves.toMatchObject({ summary: "done", metadata: { tokens: 5 } });
      // A blank completion summary leaves the previous summary alone.
      await expect(store.get(first.id)).resolves.toMatchObject({ summary: null });

      expect(await store.list({ limit: 1 })).toHaveLength(1);
      expect(await store.list({ kind: "arena" })).toMatchObject([{ id: second.id }]);
      expect(await store.list({ status: "completed" })).toHaveLength(2);
      expect(await store.list({ status: "active" })).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
