/**
 * @file resilience tests
 * @description Covers timeout, retry, and the capped breaker registry.
 */

import { describe, expect, it } from "vitest";
import { BreakerRegistry, TimeoutError, withRetry, withTimeout } from "@agentprism/runtime";

describe("withTimeout", () => {
  it("resolves fast work", async () => {
    await expect(withTimeout(async () => 7, 1000)).resolves.toBe(7);
  });

  it("times out slow work", async () => {
    await expect(
      withTimeout(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      }, 5),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates aborts without wrapping", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await withTimeout(async () => 1, 1000, { signal: controller.signal }).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
  });

  it("runs without racing when the timeout is disabled (non-positive)", async () => {
    await expect(withTimeout(async () => "slow-ok", 0)).resolves.toBe("slow-ok");
    await expect(withTimeout(async () => "still-ok", -5)).resolves.toBe("still-ok");
  });
});

describe("withRetry", () => {
  it("retries then succeeds", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("flaky");
        return "ok";
      },
      { maxRetries: 3, retryDelayMs: 1 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("never retries aborts", async () => {
    let calls = 0;
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw aborted;
        },
        { maxRetries: 3, retryDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("normalizes non-finite retry budgets to zero retries", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("always");
        },
        { maxRetries: Number.NaN, retryDelayMs: Number.NaN },
      ),
    ).rejects.toThrow("always");
    expect(calls).toBe(1);
  });

  it("aborts immediately while sleeping between retries", async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = withRetry(
      async () => {
        calls += 1;
        throw new Error("flaky");
      },
      { maxRetries: 5, retryDelayMs: 5_000 },
      { signal: controller.signal },
    );
    await Promise.resolve(); // let the first attempt fail and the backoff start
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});

describe("BreakerRegistry", () => {
  it("evicts the oldest entry past the cap", () => {
    const registry = new BreakerRegistry({ threshold: 3, cooldownMs: 1000, now: () => 0, maxSize: 2 });
    registry.get("a");
    registry.get("b");
    registry.get("c");
    expect(registry.size).toBe(2);
  });
});
