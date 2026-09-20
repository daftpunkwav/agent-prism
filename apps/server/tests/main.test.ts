/**
 * @file main tests
 * @description Lock the executable host entry sequencing for the server host.
 *
 * Responsibilities:
 * - Pin the boot order (assemble → startServer → installSignalHandlers)
 * - Pin the shutdown callback order (flushDurableStores → stop → flushDurableStores, with
 *   the second flush guaranteed even when stop() throws) so a turn
 *   committing mid-drain is never lost to the process exit
 * - Pin the boot-failure path (logged cause plus exit(1), no signal install)
 *
 * main.ts runs on import (`void main()`), so every case resets the module
 * registry first and mocks the three collaborators: no real composition,
 * no socket, no signal handlers touch the test process. Mock factories may
 * only reference `mock`-prefixed top-level bindings (vitest hoisting rule).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mockAssemble = vi.fn();
const mockStartServer = vi.fn();
const mockInstallSignalHandlers = vi.fn();

vi.mock("../src/assemble.js", () => ({ assemble: mockAssemble }));
vi.mock("../src/lifecycle.js", () => ({ installSignalHandlers: mockInstallSignalHandlers }));
vi.mock("../src/server.js", () => ({ startServer: mockStartServer }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lets the imported main()'s promise chain settle (mocked hops resolve in microtasks). */
async function flushHost(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** The shutdown callback main() hands to installSignalHandlers. */
function shutdownCallback(): (...args: never[]) => Promise<void> {
  expect(mockInstallSignalHandlers).toHaveBeenCalledOnce();
  return mockInstallSignalHandlers.mock.calls[0]?.[0] as (...args: never[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// main() entry sequencing
// ---------------------------------------------------------------------------

describe("main() entry", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    // Top-level vi.fn() collaborators keep call history across module resets
    // (restoreAllMocks only restores spyOn originals); clear explicitly so
    // each case counts exactly one boot.
    mockAssemble.mockClear();
    mockStartServer.mockClear();
    mockInstallSignalHandlers.mockClear();
    vi.restoreAllMocks();
  });

  async function importMain(): Promise<void> {
    vi.resetModules();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../src/main.js");
    await flushHost();
  }

  /**
   * Happy path: components flow assemble → startServer, then the process
   * waits on signals (installSignalHandlers last, no exit).
   */
  it("assembles, starts serving, then waits on signals", async () => {
    const components = { flushDurableStores: vi.fn().mockResolvedValue(undefined), settings: { serverShutdownGraceMs: 5_000 } };
    const stop = vi.fn().mockResolvedValue(undefined);
    mockAssemble.mockResolvedValue(components);
    mockStartServer.mockResolvedValue(stop);

    await importMain();

    expect(mockAssemble).toHaveBeenCalledOnce();
    expect(mockStartServer).toHaveBeenCalledWith(components);
    expect(mockInstallSignalHandlers).toHaveBeenCalledOnce();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  /**
   * Shutdown order: flush before stop (a turn committing mid-drain survives),
   * stop, then flush again (fire-and-forget commits land before exit).
   */
  it("flushes threads around stop() on shutdown, in order", async () => {
    const flushDurableStores = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    mockAssemble.mockResolvedValue({ flushDurableStores, settings: { serverShutdownGraceMs: 5_000 } });
    mockStartServer.mockResolvedValue(stop);

    await importMain();
    await shutdownCallback()();
    await flushHost();

    expect(flushDurableStores).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    const [firstFlush = 0, secondFlush = 0] = flushDurableStores.mock.invocationCallOrder;
    const [stopCall = 0] = stop.mock.invocationCallOrder;
    expect(firstFlush).toBeLessThan(stopCall);
    expect(stopCall).toBeLessThan(secondFlush);
  });

  /**
   * Stop failure must not drop the second flush: the turn that committed
   * while draining still lands before the (failing) shutdown propagates.
   */
  it("still runs the second flush when stop() throws", async () => {
    const flushDurableStores = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockRejectedValue(new Error("drain failed"));
    mockAssemble.mockResolvedValue({ flushDurableStores, settings: { serverShutdownGraceMs: 5_000 } });
    mockStartServer.mockResolvedValue(stop);

    await importMain();
    await expect(shutdownCallback()()).rejects.toThrow("drain failed");
    await flushHost();

    expect(flushDurableStores).toHaveBeenCalledTimes(2);
  });

  /**
   * Boot failure: the cause is logged and the process exits non-zero so
   * supervisors restart it instead of serving a half-built host. Signal
   * handlers are never installed on the dead host.
   */
  it("logs the cause and exits 1 when assemble throws", async () => {
    mockAssemble.mockRejectedValue(new Error("assemble blew up"));

    await importMain();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to start"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("assemble blew up"));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallSignalHandlers).not.toHaveBeenCalled();
  });

  /**
   * Same non-zero contract when the listener itself fails to bind: a deaf
   * host must never look healthy to the supervisor.
   */
  it("logs the cause and exits 1 when startServer throws", async () => {
    mockAssemble.mockResolvedValue({ flushDurableStores: vi.fn(), settings: { serverShutdownGraceMs: 5_000 } });
    mockStartServer.mockRejectedValue(new Error("port taken"));

    await importMain();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to start"));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallSignalHandlers).not.toHaveBeenCalled();
  });
});
