/**
 * @file sandbox-mode tests
 * @description Locks sandbox_mode wiring from run config to the actual spawn.
 *
 * Responsibilities:
 * - Pin that `sandbox_mode: os` reaches the run tool and executes under the OS
 *   write sandbox (Windows; skipped elsewhere)
 * - Pin fail-closed refusal on platforms that cannot enforce it
 */

import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { captureDriver, collect, testDeps, testSpec } from "./run-fixtures.js";

function specWith(sandboxMode: "off" | "os") {
  return {
    toolNames: ["bash"],
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", sandbox_mode: sandboxMode }),
  };
}

async function executeRun(command: string, sandboxMode: "off" | "os"): Promise<ToolExecutionResult> {
  const deps = testDeps();
  // The driver callback is sync: capture the execute promise and await it after
  // the run drains, instead of racing a floating async callback.
  let pending: Promise<ToolExecutionResult> | null = null;
  await collect(
    deps,
    testSpec(
      captureDriver((ctx) => {
        pending = ctx.tools.execute("bash", { command });
      }),
      specWith(sandboxMode),
    ),
  );
  if (pending === null) throw new Error("driver never ran");
  return pending;
}

describe("sandbox_mode wiring", () => {
  it.skipIf(process.platform !== "win32")(
    "runs the command under the OS write sandbox end to end",
    async () => {
      const outcome = await executeRun("Write-Output sbx-marker", "os");
      expect(outcome.ok).toBe(true);
      expect(outcome.result).toContain("sbx-marker");
    },
    120_000,
  );

  it.skipIf(process.platform === "win32")(
    "fails closed on platforms that cannot enforce the OS sandbox",
    async () => {
      const outcome = await executeRun("echo hi", "os");
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toContain("only enforced on Windows");
    },
    60_000,
  );

  it("keeps mode off as the default behavior", async () => {
    const outcome = await executeRun("echo hi", "off");
    expect(outcome.ok).toBe(true);
  });
});
