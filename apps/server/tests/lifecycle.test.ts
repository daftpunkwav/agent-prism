/**
 * @file lifecycle tests
 * @description Signal-driven graceful shutdown of the runtime host process.
 *
 * Responsibilities:
 * - Pin installSignalHandlers idempotency, the normal exit path, the error
 *   exit path, the in-flight repeat-signal suppression, and the 5s timeout
 *   escape hatch
 *
 * Two pieces of isolation are required:
 *   1. vi.resetModules() so each describe gets a fresh `installed` latch
 *      (the latch is module-scoped state, not a global)
 *   2. process.removeAllListeners() for SIGINT/SIGTERM/SIGBREAK — those listeners
 *      are process-scoped state and survive module resets
 *
 * vi.restoreAllMocks() plus removeAllListeners() in afterEach keep one
 * case from leaking its handlers into the next. New code should prefer
 * disposeSignalHandlers() (the public API); the raw strip below stays as the
 * backstop for handlers installed before dispose existed in a given module copy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads a fresh copy of lifecycle.js so each test starts with `installed=false`.
 * vi.resetModules() drops the module cache; the next import re-runs the
 * module body, re-initializing the latch.
 */
async function loadFresh(): Promise<typeof import("../src/lifecycle.js")> {
  vi.resetModules();
  return import("../src/lifecycle.js");
}

/** Strips SIGINT/SIGTERM/SIGBREAK listeners we may have attached to the global process. */
function stripSignalListeners(): void {
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGBREAK");
}

/** Strips crash listeners we may have attached to the global process. */
function stripCrashListeners(): void {
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
}

// ---------------------------------------------------------------------------
// installSignalHandlers
// ---------------------------------------------------------------------------

describe("installSignalHandlers", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stripSignalListeners();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    stripSignalListeners();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Happy path: a signal triggers the registered handler, stop() resolves,
   * process.exit(0) is called and the timer is cleared.
   */
  it("exits 0 once stop() resolves", async () => {
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(async () => undefined);

    process.emit("SIGTERM");
    // The handler is wired through Promise.resolve().then(...); let microtasks drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SIGTERM"));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  /**
   * Error path: stop() rejecting surfaces an exit(1) plus a printed message
   * describing the failure cause.
   */
  it("exits 1 with a printed error when stop() rejects", async () => {
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(async () => {
      throw new Error("drain failed");
    });

    process.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("drain failed"));
  });

  /**
   * Once shutdown starts, additional signals must be ignored — otherwise a
   * duplicate SIGTERM could spawn a second timer / double exit.
   */
  it("ignores repeated signals while shutdown is in flight", async () => {
    const { installSignalHandlers } = await loadFresh();
    // Box pattern: declare a nullary callable so the closure signature is
    // stable and TS does not narrow `resolveStop` to `never` after assignment.
    const box: { current: (() => void) | null } = { current: null };
    installSignalHandlers(
      () =>
        new Promise<void>((resolve) => {
          box.current = () => resolve();
        }),
    );
    const resolveStop = (): void => box.current?.();

    process.emit("SIGTERM");
    await Promise.resolve();
    process.emit("SIGTERM"); // second signal must be ignored
    process.emit("SIGTERM");
    expect(exitSpy).not.toHaveBeenCalled();

    resolveStop();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  /**
   * The `installed` latch guarantees a second installSignalHandlers() call
   * is a no-op — the second handler must never execute, even if it would throw.
   */
  it("ignores a second installSignalHandlers call (idempotent latch)", async () => {
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(async () => undefined);
    installSignalHandlers(async () => {
      throw new Error("second handler must never run");
    });

    process.emit("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // First handler wins; we never see the second handler's error.
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * The 5s timeout exists so a stuck stop() does not hang the host forever.
   When the deadline expires, we force exit(1) — non-zero so orchestrators
   see the abnormal shutdown instead of treating it as success.
   */
  it("forces exit 1 when stop() hangs past the 5s timeout", async () => {
    vi.useFakeTimers();
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(() => new Promise<void>(() => undefined)); // never resolves

    process.emit("SIGTERM");
    // Let the handler chain enter the never-resolving promise.
    await vi.advanceTimersByTimeAsync(0);

    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  /**
   * Counterpart to the timeout case: when stop() resolves in time, the
   * pending timer must be cleared so the deadline does not fire later.
   */
  it("clears the timeout when stop() resolves before the deadline", async () => {
    vi.useFakeTimers();
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(async () => undefined);

    process.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(exitSpy).toHaveBeenCalledWith(0);

    // Advance past the deadline: the timer must already be cleared.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * Windows Ctrl+Break path: SIGBREAK triggers the same shutdown chain as
   * SIGINT/SIGTERM (elsewhere the listener never fires, so it is harmless).
   */
  it("shuts down on SIGBREAK like any other stop signal", async () => {
    const { installSignalHandlers } = await loadFresh();
    installSignalHandlers(async () => undefined);

    process.emit("SIGBREAK");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SIGBREAK"));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  /**
   * disposeSignalHandlers() removes exactly what install added and resets
   * the latch, so the same module copy can be reinstalled (embedding hosts
   * and tests that cannot reset the module registry).
   */
  it("disposeSignalHandlers() detaches listeners and allows reinstall", async () => {
    const { disposeSignalHandlers, installSignalHandlers } = await loadFresh();
    const stop = vi.fn().mockResolvedValue(undefined);
    installSignalHandlers(stop);

    disposeSignalHandlers();
    expect(process.listenerCount("SIGINT")).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(0);

    // A signal after dispose reaches nobody.
    process.emit("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    // The latch is reset: reinstall works on the same module copy.
    installSignalHandlers(stop);
    process.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  /**
   * disposeSignalHandlers() with nothing installed is a safe no-op.
   */
  it("disposeSignalHandlers() is a no-op when nothing is installed", async () => {
    const { disposeSignalHandlers } = await loadFresh();
    expect(() => disposeSignalHandlers()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// installCrashHandlers
// ---------------------------------------------------------------------------

describe("installCrashHandlers", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stripCrashListeners();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    stripCrashListeners();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Drains the microtask chain inside the crash handler (log → flush → finally). */
  const drain = (): Promise<void> => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

  /**
   * Invokes OUR crash listener directly instead of emitting the process-level
   * event: the vitest worker registers its own uncaughtException/rejection
   * handlers, and an emit would trip them alongside the one under test.
   */
  const fireCrash = (event: "uncaughtException" | "unhandledRejection", error: unknown): void => {
    const handlers = process.listeners(event);
    const handler = handlers[handlers.length - 1];
    if (handler === undefined) throw new Error(`no ${event} listener installed`);
    (handler as (error: unknown, origin: string) => void)(error, event);
  };

  it("flushes best-effort and exits 1 on an uncaughtException", async () => {
    const { installCrashHandlers } = await loadFresh();
    const flush = vi.fn().mockResolvedValue(undefined);
    installCrashHandlers(flush);

    fireCrash("uncaughtException", new Error("boom"));
    await drain();

    expect(flush).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("exits 1 even when the emergency flush rejects", async () => {
    const { installCrashHandlers } = await loadFresh();
    installCrashHandlers(() => Promise.reject(new Error("flush blew up")));

    fireCrash("unhandledRejection", new Error("original fault"));
    await drain();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("flush blew up"));
  });

  it("forces exit 1 when the flush hangs past the grace timer", async () => {
    vi.useFakeTimers();
    const { installCrashHandlers } = await loadFresh();
    installCrashHandlers(() => new Promise<void>(() => undefined), { flushGraceMs: 2_000 });

    fireCrash("uncaughtException", new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("runs the flush only once when a second fault lands mid-crash", async () => {
    const { installCrashHandlers } = await loadFresh();
    let releaseFlush: (() => void) | null = null;
    const flush = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseFlush = resolve;
    }));
    installCrashHandlers(flush);

    fireCrash("uncaughtException", new Error("first"));
    await Promise.resolve();
    fireCrash("unhandledRejection", new Error("second"));
    releaseFlush?.();
    await drain();

    expect(flush).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("disposeCrashHandlers() detaches listeners and allows reinstall", async () => {
    const { disposeCrashHandlers, installCrashHandlers } = await loadFresh();
    const flush = vi.fn().mockResolvedValue(undefined);
    installCrashHandlers(flush);
    // Identity, not listenerCount: the vitest worker registers its own crash
    // handlers on the same process, so a zero count can never be asserted here.
    const ourException = process.listeners("uncaughtException").at(-1);
    const ourRejection = process.listeners("unhandledRejection").at(-1);
    expect(typeof ourException).toBe("function");
    expect(typeof ourRejection).toBe("function");

    disposeCrashHandlers();
    expect(process.listeners("uncaughtException")).not.toContain(ourException);
    expect(process.listeners("unhandledRejection")).not.toContain(ourRejection);

    // The latch is reset: reinstall works on the same module copy.
    installCrashHandlers(flush);
    fireCrash("uncaughtException", new Error("after reinstall"));
    await drain();
    expect(flush).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});