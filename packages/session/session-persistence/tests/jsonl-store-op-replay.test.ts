/**
 * @file jsonl session store op replay tests
 * @description Locks how the append-only log replays into store state: which ops
 *              apply, which are rejected as malformed, and the defaults a
 *              previous process's records come back with.
 *
 * Responsibilities:
 * - Pin create/entry/complete/fail/cancel/delete replay semantics
 * - Pin malformed-op rejection and the corrupt-line counter
 * - Pin the replay-time caps and the stale-active migration to failed
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtomicJsonFile, NodeAppendFile } from "@agentprism/persistence";
import { RandomIdGenerator, SystemClock } from "@agentprism/runtime";
import { MAX_ENTRIES_PER_SESSION, MAX_SESSIONS_PER_STORE } from "@agentprism/session";
import { JsonlSessionStore } from "../src/jsonl-session-store.js";

/** A store over a hand-written log, so replay is the only thing under test. */
function backendWithLog(lines: unknown[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-jsonl-replay-"));
  const logPath = path.join(dir, "sessions.jsonl");
  if (lines.length > 0) {
    fs.writeFileSync(logPath, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n", "utf-8");
  }
  return {
    logPath,
    store: () =>
      new JsonlSessionStore({
        log: new NodeAppendFile(logPath),
        snapshot: new AtomicJsonFile(path.join(dir, "snapshot.json")),
        idGenerator: new RandomIdGenerator(),
        clock: new SystemClock(),
      }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const createOp = (id: string, extra: Record<string, unknown> = {}) => ({
  op: "create",
  id,
  at: 1_000,
  kind: "arena",
  title: "replayed",
  ...extra,
});

describe("JsonlSessionStore log replay", () => {
  it("replays create plus entries, and marks a previous process's run failed", async () => {
    const { store, cleanup } = backendWithLog([
      createOp("s-1"),
      { op: "entry", sessionId: "s-1", at: 1_100, kind: "note", content: "first" },
      { op: "entry", sessionId: "s-1", at: 1_200, kind: "verdict", content: "second" },
    ]);
    try {
      const target = store();
      await target.list({});
      const record = await target.get("s-1");
      expect(record).toMatchObject({ id: "s-1", kind: "arena", title: "replayed", status: "failed", entryCount: 2 });
      // Entry sequence numbers heal by position, whatever the log claimed; the
      // reader returns newest first.
      const entries = await target.listEntries("s-1");
      expect(entries.map((entry) => [entry.seq, entry.kind, entry.content])).toEqual([
        [1, "verdict", "second"],
        [0, "note", "first"],
      ]);
    } finally {
      cleanup();
    }
  });

  it("applies complete, fail, and cancel ops with their summaries", async () => {
    const { store, cleanup } = backendWithLog([
      createOp("s-done"),
      { op: "complete", id: "s-done", at: 1_500, summary: "all green", metadata: { tokens: 12 } },
      createOp("s-failed"),
      { op: "fail", id: "s-failed", at: 1_600, reason: "provider error" },
      createOp("s-cancelled"),
      { op: "cancel", id: "s-cancelled", at: 1_700, reason: "cancelled by client" },
    ]);
    try {
      const target = store();
      await target.list({});
      await expect(target.get("s-done")).resolves.toMatchObject({
        status: "completed",
        summary: "all green",
        metadata: { tokens: 12 },
        updatedAt: 1_500,
      });
      await expect(target.get("s-failed")).resolves.toMatchObject({ status: "failed", summary: "provider error" });
      await expect(target.get("s-cancelled")).resolves.toMatchObject({ status: "cancelled", summary: "cancelled by client" });
    } finally {
      cleanup();
    }
  });

  it("leaves the summary alone for a summary-less complete op", async () => {
    const { store, cleanup } = backendWithLog([createOp("s-1"), { op: "complete", id: "s-1", at: 1_500, summary: "" }]);
    try {
      const target = store();
      await target.list({});
      await expect(target.get("s-1")).resolves.toMatchObject({ status: "completed", summary: null });
    } finally {
      cleanup();
    }
  });

  it("drops a deleted session and applies defaults for missing fields", async () => {
    const { store, cleanup } = backendWithLog([
      { op: "create", id: "s-1", at: 1_000 },
      { op: "entry", sessionId: "s-1", at: 1_100 },
      { op: "delete", id: "s-1" },
    ]);
    try {
      const target = store();
      expect(await target.list({})).toEqual([]);
      await expect(target.get("s-1")).resolves.toBeNull();
      // The defaults land on a record that is never deleted.
      const kept = backendWithLog([{ op: "create", id: "s-2", at: 1_000 }, { op: "entry", sessionId: "s-2", at: 1_050 }]);
      try {
        const other = kept.store();
        await other.list({});
        await expect(other.get("s-2")).resolves.toMatchObject({ kind: "agent", title: "(untitled)", metadata: {} });
        await expect(other.listEntries("s-2")).resolves.toMatchObject([{ kind: "lifecycle", content: "" }]);
      } finally {
        kept.cleanup();
      }
    } finally {
      cleanup();
    }
  });

  it("counts malformed and inapplicable ops as corrupt without dropping the good ones", async () => {
    const { store, cleanup } = backendWithLog([
      "{ not json",
      "",
      "null",
      JSON.stringify({ op: 42 }),
      JSON.stringify({ op: "create", id: "" }),
      JSON.stringify({ op: "entry", sessionId: "s-missing", at: 1 }),
      JSON.stringify({ op: "complete", id: "s-missing", at: 1 }),
      JSON.stringify({ op: "unknown-op", id: "s-1" }),
      createOp("s-1"),
    ]);
    try {
      const target = store();
      await target.list({});
      expect(target.corruptLines()).toBe(7);
      await expect(target.get("s-1")).resolves.toMatchObject({ id: "s-1" });
    } finally {
      cleanup();
    }
  });

  it("caps replayed sessions and entries instead of growing past the limits", async () => {
    const creates = Array.from({ length: MAX_SESSIONS_PER_STORE + 1 }, (_v, i) => createOp(`s-${i}`));
    const entries = Array.from({ length: MAX_ENTRIES_PER_SESSION + 1 }, (_v, i) => ({
      op: "entry",
      sessionId: "s-0",
      at: 1_000 + i,
      kind: "note",
      content: `entry ${i}`,
    }));
    const { store, cleanup } = backendWithLog([...creates, ...entries]);
    try {
      const target = store();
      const listed = await target.list({});
      expect(listed).toHaveLength(MAX_SESSIONS_PER_STORE);
      expect(await target.listEntries("s-0")).toHaveLength(MAX_ENTRIES_PER_SESSION);
      // The over-cap ops are counted as rejected, not applied silently.
      expect(target.corruptLines()).toBe(2);
    } finally {
      cleanup();
    }
  });
});
