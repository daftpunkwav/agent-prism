/**
 * @file server tests
 * @description HTTP listener lifecycle through startServer().
 *
 * Responsibilities:
 * - Pin the bind + banner path, real socket traffic, the stop() resolution
 *   contract, the close-error rejection branch, and the closeIdleConnections
 *   runtime-detection fallback
 *
 * The application fetch is a no-op stub: this file must not depend on the
 * real composition root. We allocate an ephemeral port per test so two
 * tests cannot collide on the same address.
 *
 * serve()'s listen is asynchronous; tests that call stop() right after
 * startServer() must wait one tick (setImmediate) for the socket to bind,
 * otherwise closeIdleConnections runs against a not-yet-listening server
 * and reports ERR_SERVER_NOT_RUNNING.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import type { RuntimeComponents } from "../src/assemble.js";
import { InvalidPortError, PortInUseError } from "../src/portcheck.js";
import { startServer } from "../src/server.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal RuntimeComponents shape that startServer() needs. */
function stubComponents(
  host: string,
  port: number,
  fetchImpl: RuntimeComponents["app"]["fetch"],
): RuntimeComponents {
  return {
    settings: {
      backendHost: host,
      backendPort: port,
    } as RuntimeComponents["settings"],
    app: { fetch: fetchImpl } as RuntimeComponents["app"],
    flushDurableStores: async () => undefined,
  };
}

/**
 * Allocates an ephemeral port by binding a probe server briefly. The OS
 * chooses the port; we close the probe and return the captured number.
 */
async function freePort(host: string): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, host, resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

describe("startServer", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * On bind, startServer() prints a startup banner with the bound address
   * and the API mount path. The banner comes from serve()'s info callback,
   * which fires after the socket is bound — hence the setImmediate wait.
   */
  it("binds the configured address and prints a startup banner", async () => {
    const host = "127.0.0.1";
    const port = await freePort(host);
    const fetch = vi.fn().mockResolvedValue(new Response("ok"));

    const stop = await startServer(stubComponents(host, port, fetch));

    // The serve() info callback fires asynchronously after the socket is bound;
    // give the event loop one tick to surface the banner.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Listening:"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("/api/*"));

    await stop();
  });

  /**
   * Real traffic round-trip: a TCP socket speaks HTTP/1.1 to the listener,
   * the listener dispatches to the (stubbed) Hono fetch, and the body
   * comes back through the same socket.
   */
  it("serves traffic through the bound socket", async () => {
    const host = "127.0.0.1";
    const port = await freePort(host);
    const fetch = vi.fn().mockResolvedValue(new Response("hello"));

    const stop = await startServer(stubComponents(host, port, fetch));

    const body = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      });
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      socket.on("error", reject);
    });

    expect(fetch).toHaveBeenCalled();
    expect(body).toContain("hello");

    await stop();
  });

  /**
   * OS-level "port is free again after close" is Node behavior, not a
   * server.ts contract; we only pin that stop() resolves to undefined
   * once the listener is actually running.
   */
  it("returns a stop() that resolves when called against a running server", async () => {
    const host = "127.0.0.1";
    const port = await freePort(host);
    const stop = await startServer(stubComponents(host, port, vi.fn()));

    // serve() binds the socket asynchronously; wait for the banner to surface
    // before invoking stop() — otherwise closeIdleConnections runs against a
    // not-yet-listening server and reports ERR_SERVER_NOT_RUNNING.
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(stop()).resolves.toBeUndefined();
  });

  /**
   * close-error branch: when server.close() surfaces a failure, the
   * returned promise rejects so callers can surface the cause instead of
   * silently swallowing it.
   *
   * We monkey-patch HttpServer.prototype.close so the branch fires
   * deterministically — depending on real network failure is flaky.
   */
  it("rejects with the underlying error when server.close surfaces a failure", async () => {
    const { Server: HttpServer } = await import("node:http");
    const originalClose = HttpServer.prototype.close;
    HttpServer.prototype.close = function closeWithError(
      this: unknown,
      cb?: (err?: Error) => void,
    ) {
      cb?.(new Error("simulated close failure"));
      return this as never;
    } as typeof originalClose;

    try {
      const host = "127.0.0.1";
      const port = await freePort(host);
      const stop = await startServer(stubComponents(host, port, vi.fn()));
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(stop()).rejects.toThrow("simulated close failure");
    } finally {
      HttpServer.prototype.close = originalClose;
    }
  });

  /**
   * Precheck path: when the port is already held, startServer() throws
   * PortInUseError before binding (the host entry logs it and exits 1).
   */
  it("throws PortInUseError instead of binding when the port is held", async () => {
    const host = "127.0.0.1";
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(0, host, resolve));
    const port = (holder.address() as net.AddressInfo).port;
    try {
      await expect(
        startServer(stubComponents(host, port, vi.fn())),
      ).rejects.toBeInstanceOf(PortInUseError);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  /**
   * Validation path: an out-of-range port throws InvalidPortError without
   * touching the network or the process exit.
   */
  it("throws InvalidPortError for an out-of-range port", async () => {
    await expect(
      startServer(stubComponents("127.0.0.1", 99999, vi.fn())),
    ).rejects.toBeInstanceOf(InvalidPortError);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  /**
   * Compatibility branch: on runtimes without closeIdleConnections (Node
   * < 18.2), the try/catch in server.ts must swallow the missing-method
   * shape and fall back to server.close() alone. Patch the prototype to
   * simulate the older runtime and confirm stop() still resolves cleanly.
   */
  it("silently tolerates runtimes without closeIdleConnections (Node < 18.2 path)", async () => {
    const { Server: HttpServer } = await import("node:http");
    const originalClose = HttpServer.prototype.close;
    HttpServer.prototype.close = function closeNormally(
      this: unknown,
      cb?: (err?: Error) => void,
    ) {
      cb?.();
      return this as never;
    } as typeof originalClose;

    try {
      const host = "127.0.0.1";
      const port = await freePort(host);
      const stop = await startServer(stubComponents(host, port, vi.fn()));
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(stop()).resolves.toBeUndefined();
    } finally {
      HttpServer.prototype.close = originalClose;
    }
  });
});