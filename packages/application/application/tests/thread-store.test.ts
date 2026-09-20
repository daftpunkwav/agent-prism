/**
 * @file thread store tests
 * @description Locks FileThreadStore durability semantics: caps, fork copies, stale-running reset.
 *
 * Responsibilities:
 * - Pin create/get/fork/list/delete and the atomic turn commit
 * - Pin the stale running→idle reset on load (the resume guarantee)
 * - Pin history trim caps and per-item corruption containment
 */

import { describe, expect, it } from "vitest";
import { PipelineConfigSchema, type Clock, type IdGenerator, type ThreadMessage } from "@agentprism/contracts";
import { AtomicJsonFile } from "@agentprism/persistence";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadStoreCaps } from "../src/thread-store.js";
import { FileThreadStore } from "../src/thread-store.js";

const clock: Clock = { now: () => 1_700_000_000_000 };
const ids = createIdSequence();

function createIdSequence(): IdGenerator {
  let n = 0;
  return { next: () => `id${(n += 1).toString().padStart(4, "0")}` };
}

function tempFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "thread-store-")), "threads.json");
}

function createStore(filePath = tempFilePath(), caps?: Partial<ThreadStoreCaps>): FileThreadStore {
  return new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock, caps });
}

const CONFIG = PipelineConfigSchema.parse({ label: "col" });

describe("FileThreadStore lifecycle", () => {
  it("creates, lists oldest-first, and deletes; delete refuses while running", () => {
    const store = createStore();
    const a = store.create("alpha", CONFIG);
    const b = store.create("beta", CONFIG);
    expect(store.list().map((t) => t.id)).toEqual([a.id, b.id]);

    store.markRunning(b.id, true);
    expect(() => store.delete(b.id)).toThrow(/running/);
    store.markRunning(b.id, false);
    store.delete(b.id);
    expect(store.list().map((t) => t.id)).toEqual([a.id]);
  });

  it("commits a turn atomically and keeps the workspace linkage", () => {
    const store = createStore();
    const thread = store.create("t", CONFIG);
    store.appendTurn(thread.id, "q1", "a1", "ws-1");
    const updated = store.get(thread.id);
    expect(updated.turnCount).toBe(1);
    expect(updated.workspace).toBe("ws-1");
    expect(updated.history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("does not touch the workspace on appendTurn when it is empty (failed first run)", () => {
    const store = createStore();
    const thread = store.create("t", CONFIG);
    store.setWorkspace(thread.id, "ws-keep");
    store.appendTurn(thread.id, "q", "a", "");
    expect(store.get(thread.id).workspace).toBe("ws-keep");
  });

  it("forks with copied history/config and forkOf linkage, leaving the parent untouched", () => {
    const store = createStore();
    const parent = store.create("parent", CONFIG);
    store.appendTurn(parent.id, "q1", "a1", "ws-parent");

    const fork = store.fork(parent.id, "");
    expect(fork.id).not.toBe(parent.id);
    expect(fork.forkOf).toBe(parent.id);
    expect(fork.title).toBe("parent (fork)");
    expect(fork.turnCount).toBe(parent.turnCount);
    expect(fork.history).toEqual(parent.history);
    expect(fork.workspace).toBe("");

    store.appendTurn(fork.id, "q2", "a2", "ws-fork");
    expect(store.get(parent.id).history).toHaveLength(2);
    expect(store.get(parent.id).turnCount).toBe(1);
  });

  it("trims history oldest-pairs-first when caps are exceeded", () => {
    const store = createStore();
    const thread = store.create("t", CONFIG);
    for (let i = 1; i <= 35; i += 1) {
      store.appendTurn(thread.id, `q${i}`, `a${i}`, "");
    }
    const history = store.get(thread.id).history;
    expect(history.length).toBeLessThanOrEqual(60);
    expect(history[0]?.content).toBe("q6");
    expect(history[history.length - 1]?.content).toBe("a35");
  });

  it("honors injected caps: a smaller message cap trims sooner, a larger one keeps more", () => {
    const small = createStore(tempFilePath(), { maxHistoryMessages: 4 });
    const thread = small.create("t", CONFIG);
    for (let i = 1; i <= 3; i += 1) {
      small.appendTurn(thread.id, `q${i}`, `a${i}`, "");
    }
    expect(small.get(thread.id).history).toEqual([
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ]);

    const large = createStore(tempFilePath(), { maxHistoryMessages: 200 });
    const big = large.create("t", CONFIG);
    for (let i = 1; i <= 35; i += 1) {
      large.appendTurn(big.id, `q${i}`, `a${i}`, "");
    }
    // Under the raised cap the message bound no longer trims anything.
    expect(large.get(big.id).history).toHaveLength(70);
  });

  it("honors an injected thread ceiling on create and on load", async () => {
    const store = createStore(tempFilePath(), { maxThreads: 2 });
    store.create("a", CONFIG);
    store.create("b", CONFIG);
    expect(() => store.create("c", CONFIG)).toThrow(/registry is full \(2\)/);

    // A file written beyond the injected ceiling loads only the first slice.
    const filePath = tempFilePath();
    const open = createStore(filePath);
    const ids3 = [open.create("first", CONFIG).id, open.create("second", CONFIG).id, open.create("third", CONFIG).id];
    await open.flushNow();
    const reloaded = createStore(filePath, { maxThreads: 2 });
    expect(reloaded.list().map((t) => t.id)).toEqual(ids3.slice(0, 2));
  });

  it("honors an injected characters cap while keeping the newest pair", () => {
    const store = createStore(tempFilePath(), { maxHistoryChars: 100 });
    const thread = store.create("t", CONFIG);
    store.appendTurn(thread.id, "q1", "a".repeat(80), "");
    store.appendTurn(thread.id, "q2", "b".repeat(80), "");
    const history = store.get(thread.id).history;
    // The second pair alone exceeds the cap but is never trimmed away by itself.
    expect(history).toEqual([
      { role: "user", content: "q2" },
      { role: "assistant", content: "b".repeat(80) },
    ]);
  });

  it("commits a placeholder for an empty answer so the thread survives a reload", async () => {
    const filePath = tempFilePath();
    const store = createStore(filePath);
    const thread = store.create("t", CONFIG);
    store.appendTurn(thread.id, "q1", "", "ws-1");
    await store.flushNow();

    // Regression lock: an empty answer used to fail the persisted
    // schema on reload, dropping the WHOLE thread as a corrupt record.
    const reloaded = new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock });
    const restored = reloaded.get(thread.id);
    expect(restored.turnCount).toBe(1);
    expect(restored.history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "(no answer extracted)" },
    ]);
  });

  it("clamps over-long turn text instead of dropping it", () => {
    const store = createStore();
    const thread = store.create("t", CONFIG);
    store.appendTurn(thread.id, "q", "a".repeat(40_000), "");
    const history = store.get(thread.id).history;
    expect(history[1]?.content.length).toBe(32_000);
  });
});

describe("FileThreadStore persistence", () => {
  it("resets a stale running flag to idle on load (the cross-restart resume guarantee)", async () => {
    const filePath = tempFilePath();
    const store = createStore(filePath);
    const thread = store.create("t", CONFIG);
    store.markRunning(thread.id, true);
    await store.flushNow();

    const reloaded = new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock });
    expect(reloaded.get(thread.id).running).toBe(false);
    expect(reloaded.get(thread.id).turnCount).toBe(0);
  });

  it("survives a restart with history and config intact", async () => {
    const filePath = tempFilePath();
    const store = createStore(filePath);
    const thread = store.create("t", CONFIG);
    store.appendTurn(thread.id, "q", "a", "ws");
    await store.flushNow();

    const reloaded = new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock });
    const restored = reloaded.get(thread.id);
    expect(restored.workspace).toBe("ws");
    expect(restored.config).toEqual(CONFIG);
    expect(restored.history.map((m: ThreadMessage) => m.content)).toEqual(["q", "a"]);
  });

  it("contains per-item corruption: valid threads load, invalid ones are dropped loudly", async () => {
    const filePath = tempFilePath();
    const store = createStore(filePath);
    store.create("good", CONFIG);
    await store.flushNow();

    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { threads: unknown[] };
    raw.threads.push({ id: "broken", nope: true });
    writeFileSync(filePath, JSON.stringify(raw), "utf-8");

    const reloaded = new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock });
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0]?.title).toBe("good");
  });

  it("starts empty on a file with a mismatched shape", () => {
    const filePath = tempFilePath();
    writeFileSync(filePath, JSON.stringify({ version: 1, unrelated: true }), "utf-8");
    const store = new FileThreadStore({ file: new AtomicJsonFile(filePath), idGenerator: ids, clock });
    expect(store.list()).toEqual([]);
  });

  it("writes through the injected port on flush", async () => {
    const filePath = tempFilePath();
    const store = createStore(filePath);
    store.create("t", CONFIG);
    await store.flushNow();
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { version: number; threads: unknown[] };
    expect(raw.version).toBe(1);
    expect(raw.threads).toHaveLength(1);
  });
});
