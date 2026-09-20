/**
 * @file workspace release tests
 * @description Locks workspace protection release when the driver fails.
 */

import { describe, expect, it, vi } from "vitest";
import { captureDriver, collect, terminalWorkspace, testDeps, testSpec } from "./run-fixtures.js";

describe("runAgentExecution workspace release", () => {
  it("workspace protection is released when the driver fails", async () => {
    const deps = testDeps();
    const spy = vi.spyOn(deps.workspaceRegistry, "unprotect");
    const events = await collect(
      deps,
      testSpec(captureDriver(() => {}, new Error("boom"))),
    );
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(spy).toHaveBeenCalledWith(terminalWorkspace(events, "error"));
  });
});
