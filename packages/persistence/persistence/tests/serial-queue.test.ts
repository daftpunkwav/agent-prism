/**
 * @file serial queue tests
 * @description Locks the per-key serial queue used to make storage mutations atomic.
 *
 * Responsibilities:
 * - Pin that same-key tasks never overlap and keep submission order
 * - Pin that different keys stay independent
 * - Pin that a failing task rejects its own caller without stalling the queue
 */

import { describe, expect, it } from "vitest";
import { SerialQueue } from "../src/serial-queue.js";

const tick = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("SerialQueue", () => {
  it("runs same-key tasks one at a time in submission order", async () => {
    const queue = new SerialQueue();
    const running: string[] = [];
    const order: string[] = [];
    const task = (name: string) =>
      queue.run("k", async () => {
        running.push(name);
        expect(running).toHaveLength(1);
        await tick();
        order.push(name);
        running.pop();
      });
    await Promise.all([task("a"), task("b"), task("c")]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("keeps different keys independent", async () => {
    const queue = new SerialQueue();
    let concurrent = 0;
    let peak = 0;
    const task = (key: string) =>
      queue.run(key, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await tick(2);
        concurrent -= 1;
      });
    await Promise.all([task("a"), task("b")]);
    expect(peak).toBe(2);
  });

  it("rejects the failing caller yet still runs the next task", async () => {
    const queue = new SerialQueue();
    const first = queue.run("k", async () => {
      throw new Error("boom");
    });
    const second = queue.run("k", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});
