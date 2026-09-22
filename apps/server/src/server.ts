/**
 * @file server
 * @description Binds the configured address and starts serving.
 *
 * Responsibilities:
 * - Start the HTTP listener on the loopback/designated address
 * - Return a stop function for graceful shutdown
 */

import { serve } from "@hono/node-server";
import type { RuntimeComponents } from "./assemble.js";
import { PortInUseError, ensurePortAvailable } from "./portcheck.js";

/**
 * Binds the loopback/designated address and starts serving; returns a stop function.
 * @throws InvalidPortError when the port is out of range, PortInUseError when
 *   the address is occupied (precheck or a bind race with another process).
 */
export async function startServer(components: RuntimeComponents): Promise<() => Promise<void>> {
  const { settings } = components;
  // Fast fail with guidance before binding; the error listener below covers
  // the race where the port is taken between this probe and listen().
  await ensurePortAvailable(settings.backendHost, settings.backendPort);

  // Flips in the listening callback: only errors BEFORE this point are startup
  // failures worth exiting over; runtime listener errors after it are logged
  // without killing in-flight work.
  let listening = false;

  const server = serve(
    {
      fetch: components.app.fetch,
      hostname: settings.backendHost,
      port: settings.backendPort,
    },
    (info) => {
      listening = true;
      console.log(`[server] Listening: http://${settings.backendHost}:${info.port}`);
      console.log(`[server] API served under /api/*; health check /health`);
    },
  );

  // A bind race (EADDRINUSE after the precheck) surfaces as an async 'error'
  // event, not a serve() throw: log the same friendly guidance instead of
  // crashing with a bare syscall error. Any other listener error is logged
  // verbatim: swallowing it would hide faults (EACCES, EMFILE, …).
  // An error before the server ever listened leaves a listener-less zombie
  // process (startServer has resolved, main() waits on signals forever, the
  // health check is dead): exit non-zero so the operator/supervisor restart
  // fails fast instead of a broken process that only looks alive.
  server.on("error", (error: unknown) => {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "EADDRINUSE") {
      console.error(new PortInUseError(settings.backendHost, settings.backendPort).message);
    } else {
      console.error(`[server] HTTP listener error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!listening) process.exit(1);
  });

  return () =>
    new Promise<void>((resolve, reject) => {
      // Idle keep-alive connections would otherwise hold close() open past the shutdown window.
      // ServerType typings do not declare it, so call defensively (present on Node >= 18.2 runtimes).
      try {
        (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
      } catch {
        // Runtime without the idle fast-path: close() below still works.
      }
      server.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
}
