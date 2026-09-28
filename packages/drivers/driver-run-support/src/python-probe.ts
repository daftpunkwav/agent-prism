/**
 * @file python-probe
 * @description Availability probe for the Python framework runtimes.
 *
 * Responsibilities:
 * - Resolve the interpreter (env override -> python -> python3)
 * - Probe one framework module import per probe call
 * - Cache successes module-wide for the process lifetime (installing a
 *   framework requires a restart) and failures for a short TTL so a transient
 *   fault is not pinned
 *
 * Probe policy: `auto` probes and falls back to the TypeScript pattern runtime
 * on any failure; `python` forces the framework runtime (a failed probe throws
 * at the caller); `ts` skips the probe entirely.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runtime selection for a dual-runtime driver. */
export type BridgeRuntime = "auto" | "python" | "ts";

/** Reads the runtime knob; anything unlisted keeps the auto default. */
export function runtimeFromEnv(value: string | undefined): BridgeRuntime {
  return value === "python" || value === "ts" ? value : "auto";
}

/**
 * Successful probes are cached for the process lifetime: installing a framework
 * still requires a server restart (documented in the driver READMEs). Failed
 * probes expire after this TTL instead of being pinned: the failure may be
 * transient (interpreter busy, EMFILE under load), and a permanent negative
 * cache would keep falling back to the TypeScript runtime until restart.
 */
const PROBE_FAILURE_TTL_MS = 60_000;

/** Successful probes by `${interpreter}:${module}` (process lifetime). */
const successCache = new Map<string, boolean>();
/** Failed probes by key, holding the failure timestamp (expired entries re-probe). */
const failureCache = new Map<string, number>();
/** In-flight probes by key, so concurrent callers share one spawn instead of stampeding the interpreter. */
const inFlight = new Map<string, Promise<boolean>>();

async function probeOnce(key: string, interpreter: string, moduleName: string): Promise<boolean> {
  try {
    // Output is discarded either way: `python -c "import module"` prints
    // nothing on success, and the rejection path only reads the exit status.
    await execFileAsync(interpreter, ["-c", `import ${moduleName}`], {
      timeout: 15_000,
    });
    successCache.set(key, true);
    return true;
  } catch {
    failureCache.set(key, Date.now());
    return false;
  }
}

/**
 * Returns true when `interpreter` can import `module`. Success is cached for
 * the process lifetime; failure is cached for a short TTL so a transient fault
 * retries later. Concurrent callers for the same pair await one shared probe.
 *
 * The probe is async on purpose: importing a heavy framework can take seconds,
 * and the first probe happens on the request path (a column's driver.run), so
 * a sync spawn would freeze the whole server event loop for that duration.
 */
export async function canImport(interpreter: string, moduleName: string): Promise<boolean> {
  const key = `${interpreter}:${moduleName}`;
  if (successCache.get(key) === true) return true;
  const failedAt = failureCache.get(key);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < PROBE_FAILURE_TTL_MS) return false;
    failureCache.delete(key);
  }
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;
  const probe = probeOnce(key, interpreter, moduleName);
  inFlight.set(key, probe);
  try {
    return await probe;
  } finally {
    inFlight.delete(key);
  }
}

/** Interpreter candidates in preference order (env override wins when present). */
export function interpreterCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env["ARENA_PYTHON"]?.trim();
  if (override !== "" && override !== undefined) return [override];
  return ["python", "python3"];
}

/**
 * Resolves the first interpreter that can import the framework module, or null
 * when none does (or none exists). `python` is probed before `python3` because
 * Windows ships only the unversioned name.
 */
export async function probeFrameworkRuntime(
  moduleName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  for (const interpreter of interpreterCandidates(env)) {
    if (await canImport(interpreter, moduleName)) return interpreter;
  }
  return null;
}
