/**
 * @file trace-store tests
 * @description Covers journal append/read/delete and flush durability semantics.
 *
 * Responsibilities:
 * - Pin debounced append/read-back ordering and durability
 * - Lock loud skipping of unreadable lines and delete-clears-journal semantics
 */

import { describe, expect, it } from "vitest";
import type { AppendFile } from "@agentprism/persistence";
import type { BuilderTraceRecord } from "@agentprism/contracts";
import { SessionTraceStore } from "../src/trace-store.js";

/** In-memory append-only line file standing in for NodeAppendFile. */
class MemoryAppendFile implements AppendFile {
  lines: string[] = [];
  async append(additions: string[]): Promise<void> {
    this.lines.push(...additions);
  }
  async readLines(): Promise<string[]> {
    return [...this.lines];
  }
  async rewrite(replacement: string[]): Promise<void> {
    this.lines = [...replacement];
  }
}

function makeStore(flushDebounceMs = 30_000): { store: SessionTraceStore; file: MemoryAppendFile } {
  const file = new MemoryAppendFile();
  const store = new SessionTraceStore({ open: () => file, flushDebounceMs });
  return { store, file };
}

const turnRecord = (turn = 1): BuilderTraceRecord => ({ kind: "turn", turn, ts: 1, user: "hi" });

describe("SessionTraceStore", () => {
  it("buffers appends until flush, then read returns every record", async () => {
    const { store, file } = makeStore();
    store.append("s1", turnRecord());
    store.append("s1", { kind: "event", turn: 1, event: { type: "action" } as never });
    // Debounce has not fired (long window): disk still empty.
    expect(file.lines).toHaveLength(0);
    // read flushes first, so a reader never misses accepted records.
    const records = await store.read("s1");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ kind: "turn", user: "hi" });
    expect(file.lines).toHaveLength(2);
  });

  it("skips unreadable lines instead of fabricating records", async () => {
    const { store, file } = makeStore();
    store.append("s1", turnRecord());
    await store.flush("s1");
    file.lines.push("{corrupted");
    const records = await store.read("s1");
    expect(records).toHaveLength(1);
  });

  it("delete clears the journal and pending buffer", async () => {
    const { store, file } = makeStore();
    store.append("s1", turnRecord());
    await store.delete("s1");
    expect(await store.read("s1")).toEqual([]);
    expect(file.lines).toEqual([]);
  });
});
