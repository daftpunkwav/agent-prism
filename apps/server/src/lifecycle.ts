/**
 * @file lifecycle
 * @description Signal-driven graceful shutdown of the host process.
 *
 * Responsibilities:
 * - Install signal handlers that stop serving and release resources
 * - Allow disposal (remove listeners, reset latch) for tests and embedding
 */

let installed = false;
/** Currently attached signal listeners, so disposeSignalHandlers() can remove exactly what was added. */
const attached: Array<{ event: "SIGINT" | "SIGTERM" | "SIGBREAK"; handler: () => void }> = [];

let crashInstalled = false;
/** Currently attached crash listeners, so disposeCrashHandlers() can remove exactly what was added. */
const crashAttached: Array<{ event: "uncaughtException" | "unhandledRejection"; handler: (error: unknown, origin: string) => void }> = [];

/**
 * Removes previously installed signal handlers and resets the install latch.
 * Safe to call when nothing is installed (no-op). Intended for tests and
 * embedding hosts that own the process lifetime.
 */
export function disposeSignalHandlers(): void {
  for (const { event, handler } of attached.splice(0, attached.length)) {
    process.removeListener(event, handler);
  }
  installed = false;
}

/** Installs signal-driven graceful shutdown handlers (idempotent: repeat calls are ignored). */
export function installSignalHandlers(stop: () => Promise<void>, options: { shutdownGraceMs?: number } = {}): void {
  if (installed) return;
  installed = true;
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[server] Received ${signal}, stopping…`);
    // A forced exit means graceful shutdown failed: report it with a non-zero code instead of masking it as success.
    // The timer stays referenced on purpose: it is the watchdog that forces
    // the exit when stop() hangs with no other live handles.
    const graceMs = options.shutdownGraceMs ?? 5_000;
    const timer = setTimeout(() => {
      console.error(`[server] Graceful shutdown timed out after ${graceMs}ms; forcing exit (in-flight requests may be lost)`);
      process.exit(1);
    }, graceMs);
    // stop() runs inside the promise chain: a synchronously throwing stop
    // becomes a rejection handled below instead of an uncaught exception.
    void Promise.resolve()
      .then(() => stop())
      .then(() => {
        clearTimeout(timer);
        process.exit(0);
      },
      (error) => {
        clearTimeout(timer);
        console.error(`[server] Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      });
  };
  const onSigint = (): void => { shutdown("SIGINT"); };
  const onSigterm = (): void => { shutdown("SIGTERM"); };
  const onSigbreak = (): void => { shutdown("SIGBREAK"); };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  // SIGBREAK exists on Windows (Ctrl+Break); elsewhere process.on is a no-op
  // registration that never fires, so registering unconditionally is safe.
  process.on("SIGBREAK", onSigbreak);
  attached.push(
    { event: "SIGINT", handler: onSigint },
    { event: "SIGTERM", handler: onSigterm },
    { event: "SIGBREAK", handler: onSigbreak },
  );
}

/**
 * Removes previously installed crash handlers and resets the install latch.
 * Safe to call when nothing is installed (no-op). Intended for tests and
 * embedding hosts that own the process lifetime.
 */
export function disposeCrashHandlers(): void {
  for (const { event, handler } of crashAttached.splice(0, crashAttached.length)) {
    process.removeListener(event, handler);
  }
  crashInstalled = false;
}

/**
 * Installs last-resort crash handlers (idempotent: repeat calls are ignored).
 *
 * Without them an uncaught exception or unhandled rejection kills the process
 * instantly and the debounced stores lose their unflushed tail. The handler
 * logs the fault with its stack, runs ONE bounded best-effort flush, then exits
 * non-zero — crash semantics are preserved (the process still dies, exit code
 * 1), only the durable tail is saved first. A flush that hangs or throws can
 * neither wedge the exit nor mask the crash: the grace timer is referenced on
 * purpose as the watchdog that forces the exit.
 */
export function installCrashHandlers(flush: () => Promise<void>, options: { flushGraceMs?: number } = {}): void {
  if (crashInstalled) return;
  crashInstalled = true;
  const graceMs = options.flushGraceMs ?? 2_000;
  let crashing = false;
  const onCrash = (error: unknown, origin: string): void => {
    if (crashing) return;
    crashing = true;
    console.error(`[server] Fatal ${origin}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    console.error("[server] Attempting emergency flush before exit…");
    const timer = setTimeout(() => {
      console.error(`[server] Emergency flush timed out after ${graceMs}ms; forcing exit`);
      process.exit(1);
    }, graceMs);
    void Promise.resolve()
      .then(flush)
      .catch((flushError: unknown) => {
        console.error(`[server] Emergency flush failed: ${flushError instanceof Error ? flushError.message : String(flushError)}`);
      })
      .finally(() => {
        clearTimeout(timer);
        process.exit(1);
      });
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  crashAttached.push(
    { event: "uncaughtException", handler: onCrash },
    { event: "unhandledRejection", handler: onCrash },
  );
}
