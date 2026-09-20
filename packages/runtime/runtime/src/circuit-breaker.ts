/**
 * @file circuit-breaker
 * @description Circuit breaker that short-circuits after consecutive downstream failures.
 *
 * Responsibilities:
 * - Track consecutive failures and trip at the threshold
 * - Cool down, then half-open; continued failures restart the cooldown
 * - Take an injected time function (now: () => number) so tests can fake time
 *
 * No external dependencies; safe under Node's single thread without locks.
 */

/** Consecutive-failure circuit breaker with cooldown and half-open probe. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(
    threshold: number,
    cooldownMs: number,
    private readonly now: () => number,
  ) {
    // Guard the public API like Semaphore: NaN would corrupt every comparison it touches
    // (0 < NaN is false, so a NaN threshold trips open immediately), and a non-positive
    // threshold must not start open.
    this.threshold = Number.isFinite(threshold) ? Math.max(1, Math.trunc(threshold)) : 1;
    this.cooldownMs = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 0;
  }

  /** Whether the breaker is currently open (within the cooldown). */
  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    return this.now() - this.openedAt < this.cooldownMs;
  }

  /** Records a success: resets the failure count. */
  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  /**
   * Records a failure: increments the count; at threshold (including half-open probe
   * failures) it refreshes the open timestamp, so the cooldown counts from the "last
   * failure" — conservative semantics: a persistent fault (including slow in-flight
   * failures) stays open, and concurrent probes during half-open face no single-probe gate.
   */
  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = this.now();
    }
  }

  /** Current state (for debugging). */
  get state(): "closed" | "open" | "half-open" {
    if (this.failures < this.threshold) return "closed";
    if (this.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }
}
