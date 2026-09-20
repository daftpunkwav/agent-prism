/**
 * @file Semaphore tests
 * @description Covers the Semaphore concurrency primitive.
 *
 * Responsibilities:
 * - Bound concurrent acquisitions and queue the rest
 */

import { describe, expect, it } from "vitest";
import { Semaphore } from "@agentprism/runtime";

function failAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("acquire timed out")), ms));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

describe("Semaphore", () => {
  it("review repro: permits=1, after three concurrent tasks a fourth acquire is immediate", async () => {
    const semaphore = new Semaphore(1);
    const run = async () => {
      const release = await semaphore.acquire();
      await tick();
      release();
    };
    await Promise.all([run(), run(), run()]);
    const release = await Promise.race([semaphore.acquire(), failAfter(1000)]);
    release();
  });

  it("permit count is conserved after contended handoffs with multiple permits", async () => {
    const semaphore = new Semaphore(3);
    for (let round = 0; round < 50; round += 1) {
      const tasks = Array.from({ length: 6 }, async () => {
        const release = await semaphore.acquire();
        await tick();
        release();
      });
      await Promise.all(tasks);
    }
    // Conservation check: permits acquires should be immediate; the next must block.
    const releases: Array<() => void> = [];
    for (let i = 0; i < 3; i += 1) {
      releases.push(await Promise.race([semaphore.acquire(), failAfter(1000)]));
    }
    await expect(Promise.race([semaphore.acquire(), failAfter(100)])).rejects.toThrow("acquire timed out");
    releases.forEach((release) => release());
  });

  it("repeated release returns a permit only once", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    const second = await Promise.race([semaphore.acquire(), failAfter(1000)]);
    // If repeated release inflated permits, another acquire would succeed and over-issue.
    await expect(Promise.race([semaphore.acquire(), failAfter(100)])).rejects.toThrow("acquire timed out");
    second();
  });

  it("exposes queue depth and free permits for telemetry", async () => {
    const semaphore = new Semaphore(1);
    expect(semaphore.queueDepth).toBe(0);
    expect(semaphore.freePermits).toBe(1);
    const release = await semaphore.acquire();
    expect(semaphore.freePermits).toBe(0);
    const pending = semaphore.acquire();
    await tick();
    expect(semaphore.queueDepth).toBe(1);
    release();
    (await pending)();
    expect(semaphore.queueDepth).toBe(0);
  });

  it("queued waiters can cancel via AbortSignal without leaking permits", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire(); // fill capacity
    const controller = new AbortController();
    const pending = semaphore.acquire({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("acquire cancelled");
    release();
    // Cancelled waiters must not hold a permit; after release one should be available immediately.
    const next = await Promise.race([semaphore.acquire(), failAfter(1000)]);
    next();
  });
});
