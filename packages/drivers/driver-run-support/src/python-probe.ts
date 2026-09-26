/**
 * @file python-probe
 * @description Availability probe for the Python framework runtimes.
 *
 * Responsibilities:
 * - Resolve the interpreter (env override -> python -> python3)
 * - Probe one framework module import per probe call
 * - Cache probe outcomes module-wide (success and failure alike) for the
 *   process lifetime; installing a framework requires a restart
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

const probeCache = new Map<string, boolean>();

/**
 * Returns true when `interpreter` can import `module`. Both outcomes are
 * cached by `${interpreter}:${module}` for the process lifetime: a live server
 * (or test worker) gets a stable runtime choice at zero per-run cost. Freshly
 * installing a framework therefore requires a server restart — documented in
 * the driver READMEs alongside the setup steps.
 *
 * The probe is async on purpose: importing a heavy framework can take seconds,
 * and the first probe happens on the request path (a column's driver.run), so
 * a sync spawn would freeze the whole server event loop for that duration.
 */
export async function canImport(interpreter: string, moduleName: string): Promise<boolean> {
  const key = `${interpreter}:${moduleName}`;
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;
  try {
    // Output is discarded either way: `python -c "import module"` prints
    // nothing on success, and the rejection path only reads the exit status.
    await execFileAsync(interpreter, ["-c", `import ${moduleName}`], {
      timeout: 15_000,
    });
    probeCache.set(key, true);
    return true;
  } catch {
    probeCache.set(key, false);
    return false;
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
