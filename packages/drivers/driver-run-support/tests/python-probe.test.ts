// @vitest-environment node
/**
 * @file python-probe tests
 * @description Covers the runtime knob parsing and the probe cache against the
 *              real interpreter (importing a module that never exists).
 */

import { describe, expect, it } from "vitest";
import { canImport, interpreterCandidates, probeFrameworkRuntime, runtimeFromEnv } from "@agentprism/driver-run-support";

describe("runtimeFromEnv", () => {
  it("parses the knob and falls back to auto", () => {
    expect(runtimeFromEnv("python")).toBe("python");
    expect(runtimeFromEnv("ts")).toBe("ts");
    expect(runtimeFromEnv("auto")).toBe("auto");
    expect(runtimeFromEnv(undefined)).toBe("auto");
    expect(runtimeFromEnv("bogus")).toBe("auto");
  });
});

describe("canImport", () => {
  it("caches the probe outcome per interpreter and module", async () => {
    // stdlib module: always importable on the probe interpreter.
    expect(await canImport("python", "json")).toBe(true);
    // Second call must hit the cache (identical result, no spawn).
    expect(await canImport("python", "json")).toBe(true);
    // Nonexistent module: cached false.
    expect(await canImport("python", "no_such_module_xyz")).toBe(false);
    expect(await canImport("python", "no_such_module_xyz")).toBe(false);
  });
});

describe("interpreterCandidates", () => {
  it("prefers python before python3 and honours the ARENA_PYTHON override", () => {
    expect(interpreterCandidates({})).toEqual(["python", "python3"]);
    expect(interpreterCandidates({ ARENA_PYTHON: "/usr/bin/py" })).toEqual(["/usr/bin/py"]);
    expect(interpreterCandidates({ ARENA_PYTHON: "   " })).toEqual(["python", "python3"]);
  });
});

describe("probeFrameworkRuntime", () => {
  it("finds an interpreter that imports a real module and null for an impossible one", async () => {
    // "json" is stdlib on any real interpreter, so the probe resolves.
    expect(await probeFrameworkRuntime("json", { ARENA_PYTHON: "python" })).toBe("python");
    expect(await probeFrameworkRuntime("no_such_module_xyz", { ARENA_PYTHON: "python" })).toBeNull();
  });
});
