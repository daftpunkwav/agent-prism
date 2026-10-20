// @vitest-environment node
/**
 * @file python-probe tests
 * @description Covers the runtime knob parsing and the probe cache against the
 *              real interpreter (importing a module that never exists), plus
 *              the failure-TTL expiry that keeps a transient fault from being
 *              pinned for the process lifetime.
 */

import { describe, expect, it, vi } from "vitest";
import {
  PROBE_FAILURE_TTL_MS,
  canImport,
  interpreterCandidates,
  probeFrameworkRuntime,
  runtimeFromEnv,
} from "@agentprism/driver-run-support";

/** Spawn counter: the TTL test reads the delta, so incidental calls cancel out. */
const probeCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    // Counting wrapper only: every call still runs the real execFile, so the
    // cache tests keep probing the real interpreter unchanged.
    execFile: ((...args: unknown[]) => {
      probeCalls.count += 1;
      return (actual.execFile as (...a: unknown[]) => ReturnType<typeof actual.execFile>)(...args);
    }) as typeof actual.execFile,
  };
});

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

  it("short-circuits within the failure TTL and re-probes once it expires", async () => {
    // A missing interpreter fails the real spawn instantly (ENOENT): exactly the
    // transient fault the negative cache exists to absorb.
    const interpreter = "no-such-python-ttl";
    let nowMs = 1_000_000;
    const clock = () => nowMs;
    const callsBefore = probeCalls.count;

    expect(await canImport(interpreter, "json", clock)).toBe(false);
    expect(probeCalls.count).toBe(callsBefore + 1);

    // Inside the TTL the cached failure answers without a second spawn.
    nowMs += 1_000;
    expect(await canImport(interpreter, "json", clock)).toBe(false);
    expect(probeCalls.count).toBe(callsBefore + 1);

    // Past the TTL the entry is dropped and the probe runs again (still false:
    // the assertion is the spawn count, not the verdict).
    nowMs += PROBE_FAILURE_TTL_MS;
    expect(await canImport(interpreter, "json", clock)).toBe(false);
    expect(probeCalls.count).toBe(callsBefore + 2);
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
