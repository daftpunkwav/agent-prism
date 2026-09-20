/**
 * @file event-channel
 * @description Multi-producer, multi-waiter channel merging parallel column runs (typically drained by a single consumer).
 *
 * Responsibilities:
 * - Accept pushes without blocking producers
 * - Support timeout-based receive polling
 */

export type ReceiveResult<T> =
  | { kind: "item"; value: T }
  | { kind: "timeout" }
  | { kind: "closed" };

/** Multi-producer channel drained by (typically) one consumer; close ends receives. */
export class EventChannel<T> {
  private buffer: T[] = [];
  private waiters: Array<(result: ReceiveResult<T>) => void> = [];
  private closed = false;
  private readonly capacity: number | null;
  private dropped = 0;

  /**
   * @param options.capacity Optional buffer bound (default unbounded). Past
   *   the bound the oldest buffered item drops (slow-consumer backpressure).
   *   Opt-in only: never bound report-critical streams, dropped items leave
   *   no marker for downstream aggregators.
   */
  constructor(options: { capacity?: number } = {}) {
    const capacity = options.capacity;
    // NaN-proof like Semaphore/CircuitBreaker: an unusable bound falls back to
    // unbounded instead of silently disabling the drop check.
    this.capacity = capacity === undefined || !Number.isFinite(capacity) ? null : Math.max(1, Math.trunc(capacity));
  }

  /** Buffered item count (telemetry: slow-consumer backlog). */
  size(): number {
    return this.buffer.length;
  }

  /** Items dropped past the capacity (0 when unbounded). */
  droppedCount(): number {
    return this.dropped;
  }

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ kind: "item", value: item });
      return;
    }
    this.buffer.push(item);
    // Bounded mode drops the oldest buffered item so a slow consumer cannot
    // OOM the producer side; live waiters always win over the buffer.
    if (this.capacity !== null) {
      while (this.buffer.length > this.capacity) {
        this.buffer.shift();
        this.dropped += 1;
      }
    }
  }

  /** Closes the channel; buffered events can still be drained, after which receive returns closed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter({ kind: "closed" });
    }
  }

  /**
   * Receives the next item: buffer first; when empty and open, waits up to
   * timeoutMs; timeout on expiry; closed once closed with an empty buffer.
   *
   * @param timeoutMs Poll budget per call; resolves timeout instead of hanging.
   * @returns Item value, timeout marker, or closed marker after close().
   */
  async receive(timeoutMs: number): Promise<ReceiveResult<T>> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) {
      return { kind: "item", value: buffered };
    }
    if (this.closed) {
      return { kind: "closed" };
    }
    return new Promise<ReceiveResult<T>>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter = (result: ReceiveResult<T>) => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };
      timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve({ kind: "timeout" });
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}
