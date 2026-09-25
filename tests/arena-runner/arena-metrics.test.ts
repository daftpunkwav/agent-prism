/**
 * @file arena metrics linkage tests
 * @description Locks that driver-emitted complete metrics reach the event stream and report unchanged.
 *
 * Responsibilities:
 * - Preserve tool_calls and steps from the driver complete through to the report
 * - Preserve a framework-failure complete(success=false) instead of flipping it to success
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  arenaErrorEvent,
  completeEvent,
  type ArenaEvent,
  type ArenaRunRequest,
  type PipelineConfig,
  type PipelineMetrics,
} from "@agentprism/contracts";
import type { AgentDriver, DriverLookup } from "@agentprism/contracts";
import { FrameworkDriverRegistry } from "@agentprism/driver-run-support";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { ArenaRunner } from "@agentprism/arena-runner";

function makeMetrics(overrides: Partial<PipelineMetrics> = {}): PipelineMetrics {
  return {
    success: true,
    duration_ms: 10,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    tool_calls: 0,
    steps: 0,
    context_window: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 4096,
    context_usage_pct: 0,
    input_usage_pct: 0,
    ...overrides,
  };
}

/** Fake driver: emits its own complete with real metrics (matches langchain/langgraph/native). */
function makeMetricsDriver(success: boolean): AgentDriver {
  return {
    frameworkId: "fake",
    displayName: "Fake",
    async *run(): AsyncIterable<ArenaEvent> {
      if (!success) {
        yield arenaErrorEvent({
          pipeline: "metrics-column",
          message: "framework failure",
          turn: 1,
          runId: "r",
          timestamp: 0,
          agentId: "a",
        });
      }
      yield completeEvent({
        pipeline: "metrics-column",
        workspace: "ws",
        metrics: makeMetrics({ success, tool_calls: 3, steps: 5 }),
        turn: 1,
      });
    },
  };
}

function makeConfig(label = "metrics-column"): PipelineConfig {
  return { label, endpoint_id: "ep-breaker", framework: "fake" } as PipelineConfig;
}

function makeRunner(registry: DriverLookup, runsRoot: string, label: string): ArenaRunner {
  const workspaces = new WorkspaceRegistry({ runsRoot, maxWorkspaces: 8, ttlSeconds: 3600, clock: { now: () => 0 } });
  return new ArenaRunner({
    registry,
    router: { route: (): PipelineConfig[] => [makeConfig(label)] } as never,
    workspaceRegistry: workspaces,
    // Test publisher: projects hard metrics only; does not depend on evaluation
    reportPublisher: {
      async publish(input) {
        const rows = Object.entries(input.metricsByPipeline)
          .filter((entry): entry is [string, PipelineMetrics] => entry[1] !== null)
          .map(([pipelineLabel, metrics]) => ({
            label: pipelineLabel,
            duration_ms: metrics.duration_ms,
            total_tokens: metrics.total_tokens,
            tool_calls: metrics.tool_calls,
            steps: metrics.steps,
            success: metrics.success,
          }));
        return {
          dimension: input.request.dimension,
          question: input.request.question,
          hard_metrics: { rows },
          columns: {},
          narrative: "",
        };
      },
    },
    modelFactory: {
      create: () => ({
        llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
        llmVendor: {},
        contextWindow: 128_000,
        maxInputTokens: 120_000,
      }),
    },
    idGenerator: { next: () => randomUUID().slice(0, 8) },
    clock: { now: () => 0 },
    maxConcurrentRuns: 2,
  });
}

function makeRequest(): ArenaRunRequest {
  return {
    question: "test question",
    dimension: "framework",
    selections: [],
    messages: [],
    temperature: null,
    baseline: null,
  } as unknown as ArenaRunRequest;
}

describe("ArenaRunner column metrics linkage", () => {
  const runsRoot = join(tmpdir(), `aprism-metrics-${randomUUID()}`);
  mkdirSync(runsRoot, { recursive: true });

  afterEach(() => {
    rmSync(runsRoot, { recursive: true, force: true });
  });

  it("driver-emitted complete metrics reach the event stream and report unchanged (not zeroed/flipped by agent trailing complete)", async () => {
    const registry = new FrameworkDriverRegistry();
    registry.register(makeMetricsDriver(true));
    const runner = makeRunner(registry, runsRoot, "metrics-column");

    const events: ArenaEvent[] = [];
    for await (const event of runner.streamParallel(makeRequest())) events.push(event);

    const completes = events.filter((e) => e.type === "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.metrics?.tool_calls).toBe(3);
    expect(completes[0]?.metrics?.steps).toBe(5);

    const reportEvent = events.find((e) => e.type === "report");
    expect(reportEvent).toBeDefined();
    const report = JSON.parse(reportEvent?.content ?? "") as { hard_metrics: { rows: Array<{ label: string; tool_calls: number; steps: number; success: boolean }> } };
    expect(report.hard_metrics.rows[0]?.tool_calls).toBe(3);
    expect(report.hard_metrics.rows[0]?.steps).toBe(5);
    expect(report.hard_metrics.rows[0]?.success).toBe(true);
  });

  it("framework-failure complete(success=false) is not overwritten as success", async () => {
    const registry = new FrameworkDriverRegistry();
    registry.register(makeMetricsDriver(false));
    const runner = makeRunner(registry, runsRoot, "metrics-column");

    const events: ArenaEvent[] = [];
    for await (const event of runner.streamParallel(makeRequest())) events.push(event);

    const completes = events.filter((e) => e.type === "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.metrics?.success).toBe(false);

    const reportEvent = events.find((e) => e.type === "report");
    const report = JSON.parse(reportEvent?.content ?? "") as { hard_metrics: { rows: Array<{ success: boolean }> } };
    expect(report.hard_metrics.rows[0]?.success).toBe(false);
  });
});
