/**
 * @file bridge-script
 * @description Locates a framework bridge's bundled bootstrap script.
 *
 * Responsibilities:
 * - Resolve `<package>/python/bootstrap.py` from a caller's module URL
 * - Fail loudly with the tried paths when the script is missing
 *
 * The bootstrap lives at the package root, so the offset from the calling module
 * depends on the package's build layout (`src/`, a flat `dist/`, or a nested
 * `dist/src/`) and on how the code is loaded (tsx, vitest alias, built dist).
 * Rather than hard-code one offset — the bug that made the autogen/crewai bridges
 * spawn a non-existent file whenever the framework was installed — the script is
 * found by walking up from the module's directory and probing each candidate.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** How many parent directories to probe above the calling module. */
const MAX_WALK_UP = 4;

/** Relative location of the bundled bootstrap inside a driver package. */
export const BRIDGE_SCRIPT_RELATIVE_PATH = path.join("python", "bootstrap.py");

/**
 * Resolves the bootstrap script for the package that owns `importMetaUrl`.
 *
 * @param importMetaUrl `import.meta.url` of the calling module (src or dist).
 * @returns Absolute path of the package's `python/bootstrap.py`.
 * @throws Error naming every probed candidate when none exists — a missing
 *   bootstrap must fail the column loudly instead of spawning a wrong path.
 */
export function resolveBridgeScript(importMetaUrl: string): string {
  let directory = path.dirname(fileURLToPath(importMetaUrl));
  const tried: string[] = [];
  for (let level = 0; level < MAX_WALK_UP; level += 1) {
    const candidate = path.join(directory, BRIDGE_SCRIPT_RELATIVE_PATH);
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    `Framework bridge bootstrap not found; probed ${tried.join(", ")} ` +
      `(every driver package ships ${BRIDGE_SCRIPT_RELATIVE_PATH})`,
  );
}
