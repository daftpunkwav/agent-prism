/**
 * @file execution accounting tests
 * @description Covers runAgentExecution workload accounting on synthesized terminals.
 *
 * Responsibilities:
 * - Lock that error/fallback complete events carry observed steps/tool calls, not zeroes
 *
 * Events are hand-built (same style as harness loop.test.ts): importing the drivers
 * package for its eventOf helper would drag the langchain import chain into this test
 * and blur the agent-never-depends-on-drivers boundary.
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AgentDriver,
  ArenaEvent,
  ColumnRuntime,
  PipelineConfig,
  PipelineMetrics,
} from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { runAgentExecution } from "@agentprism/agent";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";

function baseEvent(type: ArenaEvent["type"]): ArenaEvent {
  return {
    type,
    pipeline: "col",
    workspace: "ws",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r1",
    timestamp: 0,
  } as ArenaEvent;
}

function stepStart(): ArenaEvent {
  return { ...baseEvent("step_start") };
}

function toolAction(tool: string): ArenaEvent {
  return { ...baseEvent("action"), tool };
}

/** Driver stub: emits a scripted event list, then either throws or ends silently. */
function stubDriver(script: ArenaEvent[], failure?: Error): AgentDriver {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run(): AsyncGenerator<ArenaEvent> {
      for (const event of script) yield event;
      if (failure !== undefined) throw failure;
    },
  };
}

function testDeps() {
  const runsRoot = join(tmpdir(), `aprism-agent-test-${randomUUID()}`);
  const clock = new SystemClock();
  const registry = new WorkspaceRegistry({ runsRoot, clock });
  return {
    runsRoot,
    deps: { workspaceRegistry: registry, idGenerator: new RandomIdGenerator(), clock },
  };
}

function testSpec(driver: AgentDriver) {
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const columnRuntime: ColumnRuntime = {
    llm: { invoke: async () => ({}), stream: async function* () {} } as unknown as ColumnRuntime["llm"],
    llmVendor: null,
    contextWindow: 128000,
    maxInputTokens: 120000,
  };
  return {
    driver,
    config,
    question: "q",
    history: [],
    turn: 1,
    agentId: "a1",
    runId: "r1",
    columnRuntime,
  };
}

async function collect(driver: AgentDriver): Promise<{ events: ArenaEvent[]; cleanup: () => void }> {
  const { runsRoot, deps } = testDeps();
  const events: ArenaEvent[] = [];
  for await (const event of runAgentExecution(deps, testSpec(driver))) {
    events.push(event);
  }
  return { events, cleanup: () => rmSync(runsRoot, { recursive: true, force: true }) };
}

function metricsOf(events: ArenaEvent[]): PipelineMetrics {
  const terminal = events.find((event) => event.type === "complete");
  if (terminal === undefined || terminal.type !== "complete" || terminal.metrics === null) {
    throw new Error("expected a complete event with metrics");
  }
  return terminal.metrics;
}

describe("runAgentExecution synthesized terminals", () => {
  it("error path reports the steps and tool calls attempted before the failure", async () => {
    const { events, cleanup } = await collect(
      stubDriver([stepStart(), toolAction("read"), stepStart(), toolAction("write")], new Error("boom")),
    );
    try {
      expect(events.some((event) => event.type === "error")).toBe(true);
      const metrics = metricsOf(events);
      expect(metrics.success).toBe(false);
      expect(metrics.steps).toBe(2);
      expect(metrics.tool_calls).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("fallback path (driver ends without complete) reports observed workload as success", async () => {
    const { events, cleanup } = await collect(stubDriver([stepStart(), toolAction("read")]));
    try {
      const metrics = metricsOf(events);
      expect(metrics.success).toBe(true);
      expect(metrics.steps).toBe(1);
      expect(metrics.tool_calls).toBe(1);
    } finally {
      cleanup();
    }
  });
});
