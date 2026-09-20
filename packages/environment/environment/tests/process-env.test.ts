/**
 * @file childProcessEnv tests
 * @description Locks the child env allowlist.
 *
 * Responsibilities:
 * - Pin exactly which env vars reach child processes
 */

import { describe, expect, it } from "vitest";
import { childProcessEnv } from "@agentprism/environment";

describe("childProcessEnv allowlist", () => {
  it("does not pass through host env vars outside the allowlist", () => {
    const probeKey = "__APRISM_ENV_PROBE__";
    process.env[probeKey] = "secret-value";
    try {
      const env = childProcessEnv();
      expect(env[probeKey]).toBeUndefined();
      expect(env.PATH).toBeDefined();
      expect(env.PYTHONIOENCODING).toBe("utf-8");
      expect(env.NO_PROXY).toBe("*");
    } finally {
      delete process.env[probeKey];
    }
  });
});
