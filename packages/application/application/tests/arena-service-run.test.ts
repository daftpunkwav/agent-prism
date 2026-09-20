/**
 * @file arena service run tests
 * @description Locks run: stream forwarding and concurrency-slot release on success and failure.
 */

import { describe, expect, it, vi } from "vitest";
import { ArenaService, SessionService } from "@agentprism/application";
import { mockAnswerJudge, mockRouter, mockRunner, mockSessions } from "./arena-service-fixtures.js";

/** Store double whose every method throws (disk-full ledger simulation). */
function sickSessions(): any {
  const fail = async (): Promise<never> => {
    throw new Error("ledger disk full");
  };
  return { create: fail, get: fail, complete: fail, fail, appendEntry: fail, listEntries: fail, list: fail, delete: fail };
}

describe("ArenaService.run contract", () => {
  it("forwards the event stream and releases the concurrency slot", async () => {
    const runner = mockRunner();
    const release = vi.fn();
    runner.acquireSlot = vi.fn().mockResolvedValue(release);

    async function* fakeStream() {
      yield { type: "start", pipeline: "p", turn: 0, agentId: "a", runId: "r", timestamp: 1 };
      yield { type: "complete", pipeline: "p", turn: 0, agentId: "a", runId: "r", timestamp: 2 };
    }
    runner.streamParallel = vi.fn().mockReturnValue(fakeStream());

    const store = mockSessions();
    const service = new ArenaService({
      router: mockRouter() as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store }),
    });

    const events = [];
    for await (const event of service.run({} as any)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(release).toHaveBeenCalledOnce();
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("completed");
    expect(records[0]?.metadata).toMatchObject({ eventsYielded: 2 });
  });

  it("still releases the concurrency slot when the stream throws", async () => {
    const runner = mockRunner();
    const release = vi.fn();
    runner.acquireSlot = vi.fn().mockResolvedValue(release);

    async function* failingStream() {
      yield { type: "start", pipeline: "p", turn: 0, agentId: "a", runId: "r", timestamp: 1 };
      throw new Error("LLM failure");
    }
    runner.streamParallel = vi.fn().mockReturnValue(failingStream());

    const store = mockSessions();
    const service = new ArenaService({
      router: mockRouter() as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store }),
    });

    const events = [];
    try {
      for await (const event of service.run({} as any)) {
        events.push(event);
      }
    } catch {
      // expected
    }

    expect(events).toHaveLength(1);
    expect(release).toHaveBeenCalledOnce();
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("failed");
  });
});


describe("ArenaService.run ledger isolation", () => {
  it("streams and completes when the ledger is sick", async () => {
    const warn = (...args: unknown[]) => {};
    const originalWarn = console.warn;
    console.warn = warn as typeof console.warn;
    try {
      const runner = mockRunner();
      const release = vi.fn();
      runner.acquireSlot = vi.fn().mockResolvedValue(release);
      async function* fakeStream() {
        yield { type: "complete", pipeline: "p", turn: 0, agentId: "a", runId: "r", timestamp: 1 };
      }
      runner.streamParallel = vi.fn().mockReturnValue(fakeStream());
      const service = new ArenaService({
        router: mockRouter() as any,
        runnerFactory: async () => runner as any,
        answerJudge: mockAnswerJudge(),
        sessions: sickSessions(),
      });
      const events = [];
      for await (const event of service.run({} as any)) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("still surfaces run errors when ledger fail-recording throws", async () => {
    const originalWarn = console.warn;
    console.warn = (() => {}) as typeof console.warn;
    try {
      const runner = mockRunner();
      runner.acquireSlot = vi.fn().mockResolvedValue(vi.fn());
      async function* failingStream(): AsyncGenerator<never> {
        throw new Error("LLM failure");
        yield undefined as never;
      }
      runner.streamParallel = vi.fn().mockReturnValue(failingStream());
      const service = new ArenaService({
        router: mockRouter() as any,
        runnerFactory: async () => runner as any,
        answerJudge: mockAnswerJudge(),
        sessions: sickSessions(),
      });
      await expect((async () => {
        for await (const _event of service.run({} as any)) {
          // drain
        }
      })()).rejects.toThrow("LLM failure");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("ArenaService.run cancellation", () => {
  it("records cancelled (not failed) when the client aborts", async () => {
    const controller = new AbortController();
    const runner = mockRunner();
    const release = vi.fn();
    runner.acquireSlot = vi.fn().mockResolvedValue(release);
    async function* abortingStream() {
      yield { type: "start", pipeline: "p", turn: 0, agentId: "a", runId: "r", timestamp: 1 };
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    runner.streamParallel = vi.fn().mockReturnValue(abortingStream());
    const store = mockSessions();
    const service = new ArenaService({
      router: mockRouter() as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store }),
    });
    await expect((async () => {
      for await (const _event of service.run({} as any, { signal: controller.signal })) {
        // drain
      }
    })()).rejects.toThrow();
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("cancelled");
    expect(release).toHaveBeenCalledOnce();
  });
});
