/**
 * @file smoke script tests
 * @description Locks the smoke probe's startup contract: an invalid timing override
 *              must fail fast instead of degrading the readiness poll into an
 *              unbounded loop (the CI smoke job would otherwise only stop at its
 *              job timeout).
 *
 * Responsibilities:
 * - Spawn the real script with an invalid environment value
 * - Assert it exits non-zero with a message naming the bad variable
 *
 * No server is started: the validation runs before the first request.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SMOKE_SCRIPT = join(REPO_ROOT, "scripts", "smoke.mjs");

function runSmoke(overrides: Record<string, string>): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [SMOKE_SCRIPT], {
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      // Unreachable on purpose: every case below must fail before polling.
      SMOKE_BASE_URL: "http://127.0.0.1:9",
      ...overrides,
    },
  });
  return { status: result.status, stderr: result.stderr };
}

describe("smoke script timing overrides", () => {
  it("rejects a non-numeric readiness timeout", () => {
    const { status, stderr } = runSmoke({ SMOKE_TIMEOUT_MS: "abc" });
    expect(status).toBe(1);
    expect(stderr).toContain("invalid SMOKE_TIMEOUT_MS");
  });

  it("rejects a numeric prefix that is not a whole number", () => {
    // parseInt("1e5") === 1 and parseInt("30000ms") === 30000: a prefix parse
    // would silently accept both, so the whole string has to be digits.
    for (const value of ["1e5", "30000ms", "1.5"]) {
      const { status, stderr } = runSmoke({ SMOKE_TIMEOUT_MS: value });
      expect(status, value).toBe(1);
      expect(stderr, value).toContain("invalid SMOKE_TIMEOUT_MS");
    }
  });

  it("rejects a zero or negative request timeout", () => {
    const { status, stderr } = runSmoke({ SMOKE_REQUEST_TIMEOUT_MS: "0" });
    expect(status).toBe(1);
    expect(stderr).toContain("invalid SMOKE_REQUEST_TIMEOUT_MS");
  });
});
