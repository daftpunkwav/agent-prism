/**
 * @file sandbox-guard tests
 * @description Locks the catastrophic-deny invariant on the execution path.
 *
 * Responsibilities:
 * - Pin run-tool destruction blocked with unauthorized_tool, legit work passing
 */

import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@agentprism/contracts";
import { captureDriver, collect, testDeps, testSpec } from "./run-fixtures.js";

async function executeViaDriver(command: string): Promise<ToolExecutionResult> {
  const deps = testDeps();
  // The driver callback is sync: capture the execute promise and await it after
  // the run drains, instead of racing a floating async callback.
  let pending: Promise<ToolExecutionResult> | null = null;
  await collect(
    deps,
    testSpec(
      captureDriver((ctx) => {
        pending = ctx.tools.execute("run", { command });
      }),
      { toolNames: ["run"] },
    ),
  );
  if (pending === null) throw new Error("driver never ran");
  return pending;
}

describe("execution sandbox guard", () => {
  it("blocks catastrophic shell with unauthorized_tool", async () => {
    const outcome = await executeViaDriver("rm -rf /");
    expect(outcome.code).toBe("unauthorized_tool");
    expect(outcome.ok).toBe(false);
  });

  it("lets legitimate shell through to the tool", async () => {
    const outcome = await executeViaDriver("echo hi");
    expect(outcome.code).not.toBe("unauthorized_tool");
  });
});
