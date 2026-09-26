/**
 * @file load-drivers tests
 * @description Lock builtin driver composition for the server host.
 *
 * Responsibilities:
 * - Pin the loader list (one entry per builtin backend: Native, PlanExecute,
 *   SelfCritique, LangChain, LangGraph, DeepAgents, OpenAIAgents,
 *   ClaudeAgentSdk, AutoGen, CrewAI)
 * - Pin that the loader list resolves at least the native-family drivers when
 *   imported (sanity check that the imports do not silently no-op)
 * - Pin the DRIVERS env filter (unset = all, subset, normalization, unknown warns)
 *
 * Driver loading is best-effort (a broken backend warns and skips) so the
 * loader list itself is the contract — these tests only confirm the list
 * and a representative subset of registered drivers.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinDriverLoaders, registerFrameworkDrivers, selectDriverLoaders } from "../src/load-drivers.js";

// ---------------------------------------------------------------------------
// driver composition
// ---------------------------------------------------------------------------

describe("driver composition", () => {
  /**
   * The ten builtin backend loaders must all be declared; this list is
   * the single source of composition (the comment in load-drivers.ts is
   * authoritative). Removing or renaming one requires updating this test.
   */
  it("declares the ten builtin backend loaders", () => {
    expect(builtinDriverLoaders.map((loader) => loader.name).sort()).toEqual([
      "AutoGen",
      "ClaudeAgentSdk",
      "CrewAI",
      "DeepAgents",
      "LangChain",
      "LangGraph",
      "Native",
      "OpenAIAgents",
      "PlanExecute",
      "SelfCritique",
    ]);
  });

  /**
   * Real registration: registerFrameworkDrivers() resolves the loaders and
   * populates the registry. We pin a non-empty registry and a representative
   * subset of the in-process drivers (native + the two extra builtins that
   * do not depend on langchain/langgraph being installed).
   *
   * Loader imports pull the langchain chain; CI/import can exceed the
   * 5s default timeout — we extend to 60s to match the cold-import budget.
   * DRIVERS is scrubbed so a developer's local filter cannot shrink this case.
   */
  it(
    "registers a non-empty registry including native, plan_execute, self_critique",
    { timeout: 60_000 },
    async () => {
      const saved = process.env["DRIVERS"];
      delete process.env["DRIVERS"];
      try {
        const registry = await registerFrameworkDrivers();
        const ids = registry.listAvailable().map((driver) => driver.id);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids).toContain("native");
        expect(ids).toContain("plan_execute");
        expect(ids).toContain("self_critique");
      } finally {
        if (saved === undefined) delete process.env["DRIVERS"];
        else process.env["DRIVERS"] = saved;
      }
    },
  );
});

// ---------------------------------------------------------------------------
// DRIVERS env filter
// ---------------------------------------------------------------------------

describe("selectDriverLoaders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all builtins when DRIVERS is unset or blank", () => {
    expect(selectDriverLoaders(undefined).map((loader) => loader.name).sort()).toEqual([
      "AutoGen",
      "ClaudeAgentSdk",
      "CrewAI",
      "DeepAgents",
      "LangChain",
      "LangGraph",
      "Native",
      "OpenAIAgents",
      "PlanExecute",
      "SelfCritique",
    ]);
    expect(selectDriverLoaders("   ").length).toBe(10);
  });

  it("restricts to the named subset (fast local loop without heavy backends)", () => {
    const names = selectDriverLoaders("native,plan_execute,self_critique").map((loader) => loader.name).sort();
    expect(names).toEqual(["Native", "PlanExecute", "SelfCritique"]);
  });

  it("matches case-insensitively and ignores separators", () => {
    const names = selectDriverLoaders("NATIVE, plan-execute").map((loader) => loader.name).sort();
    expect(names).toEqual(["Native", "PlanExecute"]);
  });

  it("warns and ignores unknown names instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const names = selectDriverLoaders("native,bogus_driver").map((loader) => loader.name);
    expect(names).toEqual(["Native"]);
    // The warning echoes the raw token the operator typed, not the normalized form.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"bogus_driver"'));
  });

  it("fails fast naming DRIVERS when the filter selects zero known loaders", async () => {
    const saved = process.env["DRIVERS"];
    process.env["DRIVERS"] = "bogus_only";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(registerFrameworkDrivers()).rejects.toThrow(/DRIVERS=.*selected zero known drivers/);
    } finally {
      if (saved === undefined) delete process.env["DRIVERS"];
      else process.env["DRIVERS"] = saved;
    }
  });
});