/**
 * @file portcheck tests
 * @description Lock port probing behavior for the server host.
 *
 * Responsibilities:
 * - Pin the free-port vs held-port detection in portInUse()
 * - Pin ensurePortAvailable() throw semantics (silent on free, throws
 *   InvalidPortError / PortInUseError otherwise): library code never calls
 *   process.exit — the host entry owns the exit decision
 *
 * Two-stage detection (bind test + connect test) makes the implementation
 * robust against wildcard-bind hijinks; we lock both halves of that contract
 * here.
 */

import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePortAvailable,
  InvalidPortError,
  PortInUseError,
  portInUse,
} from "../src/portcheck.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOST = "127.0.0.1";

/**
 * Opens a real listener on an OS-assigned ephemeral port and holds it open
 * until the returned `close` is awaited. Tests can then probe the same port
 * to verify held-port logic without colliding with another test's socket.
 */
async function holdPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(0, HOST, resolve));
  const address = holder.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        holder.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// portInUse
// ---------------------------------------------------------------------------

describe("portInUse", () => {
  it("reports false for a free port", async () => {
    // Open then immediately close so we know the port is free at probe time.
    const probe = net.createServer();
    const port = await new Promise<number>((resolve) =>
      probe.listen(0, HOST, () => {
        const address = probe.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      }),
    );
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await expect(portInUse(HOST, port)).resolves.toBe(false);
  });

  it("reports true for a held port", async () => {
    const held = await holdPort();
    try {
      await expect(portInUse(HOST, held.port)).resolves.toBe(true);
    } finally {
      await held.close();
    }
  });
});

// ---------------------------------------------------------------------------
// ensurePortAvailable
// ---------------------------------------------------------------------------

describe("ensurePortAvailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns silently when the port is free (never touches process.exit)", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const held = await holdPort();
    const free = held.port;
    await held.close();
    await ensurePortAvailable(HOST, free);

    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("throws PortInUseError (no exit) with guidance when the port is taken", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const held = await holdPort();
    try {
      const failure = await ensurePortAvailable(HOST, held.port).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(PortInUseError);
      expect((failure as Error).message).toContain(String(held.port));
      expect((failure as Error).message).toContain("BACKEND_PORT");
      expect(exit).not.toHaveBeenCalled();
    } finally {
      await held.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("portcheck edge cases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Out-of-range ports: synchronously rejected by Node, portInUse must
   * report unavailable rather than hang on a never-settling promise.
   */
  it("treats out-of-range ports as unavailable instead of hanging", async () => {
    await expect(portInUse(HOST, 99999)).resolves.toBe(true);
  });

  /**
   * Non-integer ports (NaN, etc.): ensurePortAvailable throws
   * InvalidPortError pointing at BACKEND_PORT instead of exiting.
   */
  it("throws InvalidPortError for non-integer ports", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const failure = await ensurePortAvailable(HOST, Number.NaN).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(InvalidPortError);
    expect((failure as Error).message).toContain("BACKEND_PORT");
    expect(exit).not.toHaveBeenCalled();
  });
});
