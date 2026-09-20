/**
 * @file portcheck
 * @description Port-availability probing with typed errors (no process.exit).
 *
 * Responsibilities:
 * - Detect whether the configured port is already in use
 * - Throw InvalidPortError / PortInUseError so the caller (main/server)
 *   owns the exit decision; library code never calls process.exit
 */

import net from "node:net";

/** Thrown when the configured port is outside 1-65535 or not an integer. */
export class InvalidPortError extends Error {
  readonly host: string;
  readonly port: number;
  constructor(host: string, port: number) {
    super(`[server] Invalid port: ${port} (expected 1-65535; check BACKEND_PORT in .env)`);
    this.name = "InvalidPortError";
    this.host = host;
    this.port = port;
  }
}

/** Thrown when the configured host:port is already occupied. */
export class PortInUseError extends Error {
  readonly host: string;
  readonly port: number;
  constructor(host: string, port: number) {
    super(
      `[server] Port in use: ${host}:${port}\n` +
        `  Windows: netstat -ano | findstr ${port}\n` +
        `  macOS/Linux: lsof -i :${port}\n` +
        `  Free the port or change BACKEND_PORT in .env and retry.`,
    );
    this.name = "PortInUseError";
    this.host = host;
    this.port = port;
  }
}

/** Port-occupancy check: a hit on either the bind test or the connect test counts as in use. */
export function portInUse(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (inUse: boolean) => {
      if (settled) return;
      settled = true;
      resolve(inUse);
    };
    const server = net.createServer();
    server.once("error", () => {
      finish(true);
    });
    // A late second error (after the probe below closed the server) would otherwise
    // throw as an unhandled 'error' event; it carries no new information.
    server.on("error", () => {});
    server.once("listening", () => {
      server.close(() => {
        // bind may succeed on a different interface while the port is still reachable; connect catches that
        const socket = net.createConnection({ host, port });
        const done = (inUse: boolean) => {
          socket.destroy();
          finish(inUse);
        };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
        socket.setTimeout(timeoutMs, () => done(false));
      });
    });
    try {
      server.listen(port, host);
    } catch {
      // Synchronous bind rejection (e.g. out-of-range port): report unavailable
      // instead of leaving the caller hanging on a never-settling promise.
      finish(true);
    }
  });
}

/**
 * Throws InvalidPortError / PortInUseError when the port cannot be used
 * (no automatic port fallthrough, avoiding broken chains across services).
 * Never calls process.exit: the host entry (main.ts) logs and exits.
 */
export async function ensurePortAvailable(host: string, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidPortError(host, port);
  }
  const inUse = await portInUse(host, port);
  if (!inUse) return;
  throw new PortInUseError(host, port);
}
