/**
 * @file resilience
 * @description Shared timeout/retry/breaker-registry helpers for runners.
 *
 * Responsibilities:
 * - Race async work against a timeout (AbortError never swallowed)
 * - Retry transient failures a bounded number of times (abort-aware)
 * - Hold per-endpoint circuit breakers behind a capped LRU registry
 *
 * No external dependencies; runners share this instead of each re-tuning
 * thresholds, cooldowns, and unbounded breaker maps.
 */

import { CircuitBreaker } from "./circuit-breaker.js";

/** Bounded retry policy (delays use setTimeout; abort stops waiting). */
export interface RetryPolicy {
  /** Retries after the initial attempt (0 = no retry). */
  maxRetries: number;
  /** Delay between attempts in ms. */
  retryDelayMs: number;
}

/** Default retry policy: two retries with a short backoff. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, retryDelayMs: 250 };

/** Error raised when withTimeout exceeds its budget. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      reject(aborted);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    // Never pin the event loop on a backoff nap (house timer convention).
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      reject(aborted);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Races task against timeoutMs (must be finite and > 0; non-positive disables
 * the timeout and just runs the task). Abort errors propagate unwrapped.
 */
export async function withTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task();
  const signal = options.signal;
  if (signal?.aborted) {
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    throw aborted;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectRace: ((error: Error) => void) | undefined;
  // Named once-listeners on both sides so the finally below detaches whatever
  // the race left behind: a long-lived caller signal must not accumulate one
  // entry per timed call (listener leak).
  const onAbortTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
  };
  const onAbortRace = () => {
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    rejectRace?.(aborted);
  };
  signal?.addEventListener("abort", onAbortTimer, { once: true });
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        rejectRace = reject;
        timer = setTimeout(() => {
          reject(new TimeoutError(`Operation timed out after ${Math.trunc(timeoutMs)}ms`));
        }, Math.trunc(timeoutMs));
        timer.unref?.();
        signal?.addEventListener("abort", onAbortRace, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbortTimer);
    signal?.removeEventListener("abort", onAbortRace);
  }
}

/**
 * Runs task with bounded retries. AbortError is never retried (a cancelled
 * caller observes cancellation immediately, even mid-backoff); every other
 * error — including TimeoutError — retries until the budget is spent.
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const maxRetries = Number.isFinite(policy.maxRetries) ? Math.max(0, Math.trunc(policy.maxRetries)) : 0;
  const delayMs = Number.isFinite(policy.retryDelayMs) ? Math.max(0, policy.retryDelayMs) : 0;
  let attempt = 0;
  for (;;) {
    try {
      return await task();
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (attempt >= maxRetries) throw error;
      attempt += 1;
      await sleep(delayMs, options.signal);
    }
  }
}

/**
 * Capped per-key breaker registry with LRU eviction (insertion-order map).
 * Eviction drops that key's failure count: sized for endpoint-cardinality
 * workloads (hundreds), not for unbounded per-request keys.
 */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly maxSize: number;
  private readonly now: () => number;

  constructor(options: { threshold: number; cooldownMs: number; now: () => number; maxSize?: number }) {
    this.threshold = options.threshold;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now;
    const maxSize = options.maxSize ?? 500;
    this.maxSize = Number.isFinite(maxSize) ? Math.max(1, Math.trunc(maxSize)) : 500;
  }

  /** Current registry size (breaker count, for telemetry). */
  get size(): number {
    return this.breakers.size;
  }

  /** Returns the breaker for key, creating and evicting LRU entries as needed. */
  get(key: string): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing !== undefined) {
      // Refresh LRU order on hit.
      this.breakers.delete(key);
      this.breakers.set(key, existing);
      return existing;
    }
    const breaker = new CircuitBreaker(this.threshold, this.cooldownMs, this.now);
    this.breakers.set(key, breaker);
    while (this.breakers.size > this.maxSize) {
      const oldest = this.breakers.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.breakers.delete(oldest);
    }
    return breaker;
  }
}
