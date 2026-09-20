/**
 * @file semaphore
 * @description Counting semaphore bounding concurrent run execution.
 *
 * Responsibilities:
 * - Limit simultaneous workers to the configured capacity
 * - Queue acquirers until a slot frees up
 * - Normalize permits to a finite integer >= 1.
 */

/** acquire cancellation signal: rejection when aborted while queued; permit count is unaffected. */
export interface AcquireOptions {
  signal?: AbortSignal;
}

/** Counting semaphore bounding concurrent runs; FIFO waiters, abort-safe acquire. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    // Guard the public API: NaN would hang every acquirer forever (NaN > 0 is false)
    // and fractions would over-admit workers, so normalize to a finite integer >= 1.
    const normalized = Number.isFinite(permits) ? Math.trunc(permits) : 1;
    this.available = Math.max(1, normalized);
  }

  /** Queued acquirer count (telemetry: run/column queue depth). */
  get queueDepth(): number {
    return this.waiters.length;
  }

  /** Currently free permits (telemetry). */
  get freePermits(): number {
    return this.available;
  }

  /**
   * Acquires one permit, queuing FIFO when exhausted.
   *
   * @param options AbortSignal rejects queued acquirers without consuming permits.
   * @returns Release callback; callers must release in finally.
   */
  async acquire(options: AcquireOptions = {}): Promise<() => void> {
    const signal = options.signal;
    if (signal?.aborted) {
      throw new Error("acquire cancelled");
    }
    if (this.available > 0) {
      this.available -= 1;
      return this.makeRelease();
    }
    return new Promise((resolve, reject) => {
      // When a waiter is woken, release transfers the permit directly; no double decrement.
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.makeRelease());
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("acquire cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** The release function takes effect once; repeated calls never inflate the permit count. */
  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      // Permit handover: holder decrements, waiter increments; available stays unchanged.
      waiter();
      return;
    }
    this.available += 1;
  }
}
