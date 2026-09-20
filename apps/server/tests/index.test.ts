/**
 * @file index tests
 * @description Lock the server barrel surface for apps/server.
 *
 * Responsibilities:
 * - Pin the exact runtime export set so an added or dropped export is a
 *   deliberate, reviewed change
 * - Pin that every function export is callable (no stub or undefined leaking
 *   through a barrel typo); builtinDriverLoaders is data and exempt
 *
 * Type-only exports (RuntimeComponents) are erased at runtime and are
 * asserted by the web/server typechecks, not here. Importing the
 * barrel pulls the assemble chain (langchain); the timeout mirrors the
 * load-drivers cold-import budget.
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// barrel surface
// ---------------------------------------------------------------------------

describe("server barrel", () => {
  /**
   * Exact runtime key set: main.ts and external hosts consume this barrel,
   * so surface drift (a new export nobody reviewed, a removed export a
   * caller still needs) fails here first.
   */
  it(
    "exposes exactly the host-facing runtime helpers",
    { timeout: 60_000 },
    async () => {
      const barrel = await import("../src/index.js");
      expect(Object.keys(barrel).sort()).toEqual([
        "InvalidPortError",
        "PortInUseError",
        "assemble",
        "builtinDriverLoaders",
        "disposeSignalHandlers",
        "ensurePortAvailable",
        "installSignalHandlers",
        "mountDomainRoutes",
        "portInUse",
        "registerFrameworkDrivers",
        "selectDriverLoaders",
        "startServer",
      ]);
    },
  );

  /**
   * Every function barrel export must be callable: a barrel typo that
   * re-exports an undefined binding would otherwise surface only at
   * production boot. builtinDriverLoaders is the loader table (data).
   */
  it(
    "exposes only callable functions plus the loader table",
    { timeout: 60_000 },
    async () => {
      const barrel = (await import("../src/index.js")) as Record<string, unknown>;
      for (const [name, value] of Object.entries(barrel)) {
        if (name === "builtinDriverLoaders") {
          expect(Array.isArray(value)).toBe(true);
          continue;
        }
        expect(typeof value, name).toBe("function");
      }
    },
  );
});
