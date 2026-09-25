/**
 * @file session-store.test
 * @description Unit tests for the builder session store.
 *
 * Responsibilities:
 * - Pin turn commits, notice queues, caps, and persistence round-trips
 */

import { describe, expect, it } from "vitest";
import type { BuilderChatMessage, BuilderComposition } from "@agentprism/contracts";
import type { JsonFile } from "@agentprism/persistence";
import { BuilderCompositionSchema } from "@agentprism/contracts";
import { BuilderError } from "@agentprism/builder-turns";
import { BuilderSessionStore } from "../src/session-store.js";

/** In-memory stand-in for AtomicJsonFile (same port, no disk IO). */
class MemoryJsonFile implements JsonFile {
  payload: unknown = null;
  read<T>(): T | null {
    return this.payload === null ? null : (structuredClone(this.payload) as T);
  }
  async write(payload: unknown): Promise<void> {
    this.payload = structuredClone(payload);
  }
}

let counter = 0;
function makeStore(file: JsonFile = new MemoryJsonFile()): BuilderSessionStore {
  counter += 1;
  return new BuilderSessionStore({
    file,
    idGenerator: { next: () => `sess-${counter}-${Math.random().toString(16).slice(2, 8)}` },
    clock: { now: () => 1_790_000_000_000 },
  });
}

const composition: BuilderComposition = BuilderCompositionSchema.parse({});

describe("BuilderSessionStore", () => {
  it("creates, gets, lists, and deletes sessions", () => {
    const store = makeStore();
    const record = store.create("My Agent", composition);
    expect(record.name).toBe("My Agent");
    expect(store.get(record.id).id).toBe(record.id);
    expect(store.list()).toHaveLength(1);
    store.delete(record.id);
    expect(() => store.get(record.id)).toThrow(BuilderError);
  });

  it("commits one turn atomically and trims history to the message cap", () => {
    const store = makeStore();
    const record = store.create("", composition);
    for (let i = 0; i < 40; i += 1) {
      store.appendTurn(record.id, `question ${i}`, `answer ${i}`, `ws-${i}`);
    }
    const after = store.get(record.id);
    expect(after.turnCount).toBe(40);
    expect(after.history.length).toBeLessThanOrEqual(60);
    expect(after.history.length % 2).toBe(0);
    expect(after.history.at(-1)?.content).toBe("answer 39");
    expect(after.workspaceName).toBe("ws-39");
  });

  it("keeps history alternating user/assistant after trimming", () => {
    const store = makeStore();
    const record = store.create("", composition);
    for (let i = 0; i < 35; i += 1) {
      store.appendTurn(record.id, `q${i}`.repeat(200), `a${i}`.repeat(200), "");
    }
    const history: BuilderChatMessage[] = store.get(record.id).history;
    for (let i = 0; i < history.length; i += 1) {
      expect(history[i]?.role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("counts tool-round chars toward the history char cap when trimming", () => {
    const store = makeStore();
    const record = store.create("", composition);
    // Each turn carries 30k chars of rounds: content-only accounting would keep
    // every pair and blow the 96k cap once rounds are counted.
    const rounds = [{ tool: "read", args: {}, result: "x".repeat(30_000) }];
    for (let i = 0; i < 5; i += 1) {
      store.appendTurn(record.id, `q${i}`, `a${i}`, "", i + 1, rounds);
    }
    const history: BuilderChatMessage[] = store.get(record.id).history;
    const total = history.reduce(
      (sum, m) =>
        sum +
        m.content.length +
        (m.tool_rounds ?? []).reduce((acc, round) => acc + round.tool.length + JSON.stringify(round.args).length + round.result.length, 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(96_000);
    expect(history.length).toBeLessThan(10);
  });

  it("queues and drains notices exactly once", () => {
    const store = makeStore();
    const record = store.create("", composition);
    store.queueNotice(record.id, "notice-a");
    store.queueNotice(record.id, "notice-b");
    expect(store.takeNotices(record.id)).toEqual(["notice-a", "notice-b"]);
    expect(store.takeNotices(record.id)).toEqual([]);
  });

  it("rejects hot-swaps while a turn is running", () => {
    const store = makeStore();
    const record = store.create("", composition);
    store.markRunning(record.id, true);
    expect(() => store.updateComposition(record.id, { ...composition, temperature: 0.5 })).toThrow(BuilderError);
    store.markRunning(record.id, false);
    expect(() => store.updateComposition(record.id, { ...composition, temperature: 0.5 })).not.toThrow();
  });

  it("round-trips sessions through the file and resets stale running flags", async () => {
    const file = new MemoryJsonFile();
    const store = makeStore(file);
    const record = store.create("Persisted", composition);
    store.queueNotice(record.id, "ephemeral");
    store.markRunning(record.id, true);
    await store.flushNow();

    const reloaded = makeStore(file);
    const restored = reloaded.get(record.id);
    expect(restored.name).toBe("Persisted");
    expect(restored.running).toBe(false);
  });

  it("keeps valid sessions when a sibling record is corrupt", () => {
    const file = new MemoryJsonFile();
    file.payload = {
      version: 1,
      sessions: [
        {
          id: "sess-good",
          name: "Survivor",
          createdAt: 1_790_000_000_000,
          updatedAt: 1_790_000_000_000,
          composition,
          history: [],
          workspaceName: "",
          turnCount: 0,
        },
        // Malformed sibling: must be skipped loudly, never wipe the registry.
        { id: "sess-bad", name: 42, composition: "garbage" },
      ],
    };
    const store = makeStore(file);
    expect(store.list()).toHaveLength(1);
    expect(store.get("sess-good").name).toBe("Survivor");
  });

  it("starts empty on a corrupted file instead of throwing", async () => {
    const file = new MemoryJsonFile();
    await file.write({ version: 1, sessions: "garbage" });
    const store = makeStore(file);
    expect(store.list()).toHaveLength(0);
  });

  it("truncates an overgrown session file to the registry cap on load", () => {
    const file = new MemoryJsonFile();
    const sessions = Array.from({ length: 55 }, (_, i) => ({
      id: `sess-${i}`,
      name: `Agent ${i}`,
      createdAt: 1_790_000_000_000,
      updatedAt: 1_790_000_000_000,
      composition,
      history: [],
      workspaceName: "",
      turnCount: 0,
    }));
    file.payload = { version: 1, sessions };
    const store = makeStore(file);
    expect(store.list()).toHaveLength(50);
    expect(store.get("sess-0").name).toBe("Agent 0");
  });

  it("caps the pending notice queue, evicting oldest first", () => {
    const store = makeStore();
    const record = store.create("", composition);
    for (let i = 0; i < 25; i += 1) store.queueNotice(record.id, `notice-${i}`);
    const drained = store.takeNotices(record.id);
    expect(drained).toHaveLength(20);
    expect(drained[0]).toBe("notice-5");
    expect(drained.at(-1)).toBe("notice-24");
  });
});
