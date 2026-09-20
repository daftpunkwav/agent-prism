/**
 * @file tool override tests
 * @description Locks explicit tool-name overrides: exact replacement and fail-closed drops.
 */

import { describe, expect, it } from "vitest";
import { captureDriver, collect, terminalWorkspace, testDeps, testSpec } from "./run-fixtures.js";

describe("runAgentExecution tool overrides", () => {
  it("explicit tool names replace the toolset mapping exactly", async () => {
    let names: ReadonlySet<string> | undefined;
    const deps = testDeps();
    const events = await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        names = ctx.tools.names;
      }), { toolNames: ["read", "write"] }),
    );
    expect([...(names ?? [])].sort()).toEqual(["read", "write"]);
    expect(terminalWorkspace(events, "complete")).not.toBe("");
  });

  it("an empty tool-name override runs with no tools", async () => {
    let names: ReadonlySet<string> | undefined;
    const deps = testDeps();
    await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        names = ctx.tools.names;
      }), { toolNames: [] }),
    );
    expect(names?.size).toBe(0);
  });

  it("unknown tool names are dropped fail-closed", async () => {
    let names: ReadonlySet<string> | undefined;
    const deps = testDeps();
    await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        names = ctx.tools.names;
      }), { toolNames: ["read", "no_such_tool"] }),
    );
    expect([...(names ?? [])]).toEqual(["read"]);
  });

});
