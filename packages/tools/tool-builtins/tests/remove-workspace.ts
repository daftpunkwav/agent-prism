/**
 * @file remove workspace
 * @description Test cleanup helper for workspaces that hosted spawned commands.
 *
 * Responsibilities:
 * - Remove a temp workspace directory with bounded retries
 * - Allow callers holding timeout-killed children to extend the budget
 *
 * Windows releases a child's directory handle (its cwd) a moment after the exit
 * event, so an immediate rmSync can fail with EPERM, and on-access scanning can
 * lock freshly written files. The retries absorb only that release lag; a
 * genuinely undeletable directory still surfaces after the bounded attempts.
 */

import fs from "node:fs";

const ATTEMPTS = 10;
const RETRY_DELAY_MS = 50;

/** Removes a test workspace directory, retrying the OS handle-release lag. */
export function removeWorkspace(root: string, budgetMs = 0): void {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() >= deadline && attempt >= ATTEMPTS) throw error;
      // Synchronous backoff: cleanup runs in test teardown, where blocking is fine.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS);
    }
  }
}
