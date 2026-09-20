/**
 * @file repeat-guard test
 * @description Locks end-to-end repeat reminders through column tool access.
 */
import { describe, expect, it } from "vitest";
import type { AgentExecutionContext } from "@agentprism/harness";
import type { ArenaEvent } from "@agentprism/contracts";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

describe("runAgentExecution repeat guard", () => {
  it("appends a reminder on the third identical successful call", async () => {
    const results: string[] = [];
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        for (let i = 0; i < 3; i += 1) {
          // ls on the workspace root always succeeds: only ok executions count.
          results.push((await ctx.tools.execute("ls", { path: "." })).result);
        }
      },
    };
    await collect(testDeps(), testSpec(driver));
    expect(results).toHaveLength(3);
    expect(results[0]).not.toContain("Repeat guard");
    expect(results[1]).not.toContain("Repeat guard");
    expect(results[2]).toContain("Repeat guard");
  });
});
