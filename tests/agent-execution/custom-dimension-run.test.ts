/**
 * @file custom dimension run tests
 * @description Cross-package journey: a registered custom dimension reaches a run.
 *
 * Responsibilities:
 * - Pin that a run's `custom` record resolves against the live registry at assembly
 * - Pin that the dimension's budget/messages hooks reach the driver through the
 *   tuning bag every driver spreads into the context pipeline
 * - Pin that an id no package provides fails the column before the driver runs
 *
 * The router half of the chain (axis -> one column per value -> `config.custom`) is
 * pinned in arena-dimensions' custom-dimension-journey test; this file pins what the
 * run does with those configs, using the shipped dimension packages as its fixtures.
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDriver, ArenaEvent, LlmMessage, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { runAgentExecution, type AgentExecutionDeps, type AgentRunSpec } from "@agentprism/agent";
import {
  applyContextPipeline,
  buildSystemUser,
  registerCustomDimensions,
  type AgentExecutionContext,
} from "@agentprism/harness";
import { summaryBudgetDimension } from "@agentprism/summary-budget";
import { toolReplayDimension } from "@agentprism/tool-replay";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";

registerCustomDimensions([summaryBudgetDimension, toolReplayDimension]);

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

function testDeps(): AgentExecutionDeps {
  const runsRoot = join(tmpdir(), `aprism-custom-run-${randomUUID()}`);
  roots.push(runsRoot);
  const clock = new SystemClock();
  return {
    workspaceRegistry: new WorkspaceRegistry({ runsRoot, clock }),
    idGenerator: new RandomIdGenerator(),
    clock,
  };
}

function spec(driver: AgentDriver, config: PipelineConfig): AgentRunSpec {
  return {
    driver,
    config,
    question: "q",
    history: [],
    turn: 1,
    agentId: "a1",
    runId: "r1",
    columnRuntime: {
      llm: { invoke: async () => ({}) } as unknown as AgentRunSpec["columnRuntime"]["llm"],
      llmVendor: null,
      contextWindow: 128_000,
      maxInputTokens: 120_000,
    },
  };
}

/** Driver stub that captures its execution context and ends silently. */
function captureDriver(onContext: (ctx: AgentExecutionContext) => void): AgentDriver {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
      onContext(ctx);
    },
  };
}

async function run(driver: AgentDriver, config: PipelineConfig): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of runAgentExecution(testDeps(), spec(driver, config))) events.push(event);
  return events;
}

describe("custom dimension runs", () => {
  it("resolves the axis value and folds its budget hook into the run's tuning bag", async () => {
    const seen: AgentExecutionContext[] = [];
    const driver = captureDriver((ctx) => seen.push(ctx));

    await run(driver, PipelineConfigSchema.parse({ label: "budget 2000", harness: "bare", custom: { summary_budget: "2000" } }));
    await run(driver, PipelineConfigSchema.parse({ label: "budget 8000", harness: "bare", custom: { summary_budget: "8000" } }));

    const [small, large] = seen as [AgentExecutionContext, AgentExecutionContext];
    // The config's value resolves to the registered descriptor (registration order).
    expect(small.customDimensions?.map((entry) => [entry.dimension.id, entry.value])).toEqual([["summary_budget", "2000"]]);
    // The budget hook lands on the bag every driver spreads into applyContextPipeline.
    expect(small.contextTuning?.summaryMaxChars).toBe(8_000);
    expect(large.contextTuning?.summaryMaxChars).toBe(32_000);
    // The prompt tag states which value the column ran under.
    expect(buildSystemUser(small).system).toContain("[Context: summary digest budget 2000 tokens]");
    expect(buildSystemUser(large).system).toContain("[Context: summary digest budget 8000 tokens]");
  });

  it("shapes the model-visible messages through the bag for a registered messages hook", async () => {
    const seen: AgentExecutionContext[] = [];
    const driver = captureDriver((ctx) => seen.push(ctx));
    const transcript: LlmMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", args: { path: "a.ts" } }] },
      { role: "tool", content: "export function a() {}", toolCallId: "c1", name: "read" },
      { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "write", args: { path: "b.ts" } }] },
      { role: "tool", content: "Wrote: b.ts", toolCallId: "c2", name: "write" },
    ];

    await run(driver, PipelineConfigSchema.parse({ label: "writes", harness: "bare", custom: { tool_replay: "writes_only" } }));
    await run(driver, PipelineConfigSchema.parse({ label: "all", harness: "bare", custom: { tool_replay: "all" } }));

    const [writesOnly, all] = seen as [AgentExecutionContext, AgentExecutionContext];
    // A driver forwards the bag verbatim (the spread `...context.contextTuning`).
    const shape = (ctx: AgentExecutionContext): LlmMessage[] =>
      applyContextPipeline([...transcript], ctx.config.context, { ...ctx.contextTuning });
    const omitted = shape(writesOnly);
    const toolContent = (messages: LlmMessage[], name: string): string | undefined =>
      messages.find((message) => message.role === "tool" && message.name === name)?.content;
    expect(toolContent(omitted, "read")).toContain("omitted");
    expect(toolContent(omitted, "write")).toBe("Wrote: b.ts");
    // Pairing survives the hook: the shared tail never leaves an orphaned call.
    expect(omitted.filter((message) => message.role === "tool")).toHaveLength(2);
    expect(toolContent(shape(all), "read")).toBe("export function a() {}");
  });

  it("fails the column loudly for a value no package provides, before the driver runs", async () => {
    let driverRan = false;
    const driver: AgentDriver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(): AsyncGenerator<ArenaEvent> {
        driverRan = true;
      },
    };
    const logged: string[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    let events: ArenaEvent[] = [];
    try {
      events = await run(
        driver,
        PipelineConfigSchema.parse({ label: "ghost", harness: "bare", custom: { ghost_axis: "x" } }),
      );
    } finally {
      console.error = consoleError;
    }

    // Fail closed: never run a different experiment than the stored config asked for.
    expect(driverRan).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.some((event) => event.type === "complete" && event.metrics?.success === true)).toBe(false);
    // The wire message is the error name; the operator diagnostic names the axis.
    expect(logged.some((line) => line.includes("ghost_axis"))).toBe(true);
  });
});
