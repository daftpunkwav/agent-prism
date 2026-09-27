/**
 * @file column stop tests
 * @description End-to-end per-column stop through the real agent layer.
 *
 * Responsibilities:
 * - Pin the stopped column's terminal events (stopped marker, failed complete)
 * - Pin that a stop is isolated: siblings finish, slots release, no breaker count
 *
 * The runner is real and the agent layer is real (no mocked runAgentExecution):
 * the stop path crosses runner -> agent -> harness -> driver, and its contract is
 * exactly what a mocked boundary cannot show.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentDriver,
  ArenaEvent,
  ArenaRunRequest,
  ColumnRuntime,
  DriverLookup,
  PipelineConfig,
} from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import { ArenaRunner } from "../src/runner.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Fields the stub drivers read. The AgentDriver port types its context as
 * `unknown` on purpose (it stays free of the harness dependency), so the stub
 * declares exactly the members it uses instead of pulling harness in as a dep.
 */
interface RunContext {
  config: { label: string };
  signal?: AbortSignal;
  turn: number;
  identity: { runId: string };
  clock: { now: () => number };
}

function config(label: string, framework: string): PipelineConfig {
  return PipelineConfigSchema.parse({ label, framework, harness: "bare" });
}

/** Column that renders nothing and blocks until cancelled, then throws like a real driver. */
function hangDriver(framework: string): AgentDriver {
  return {
    frameworkId: framework,
    displayName: "Hang",
    async *run(ctx: RunContext): AsyncGenerator<ArenaEvent> {
      await new Promise<void>((resolve) => {
        if (ctx.signal?.aborted === true) {
          resolve();
          return;
        }
        ctx.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      // Real backends throw AbortError from the cancelled call; the langchain
      // family ends its stream instead. Both must land on the same terminal.
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      throw aborted;
    },
  };
}

function doneDriver(framework: string): AgentDriver {
  return {
    frameworkId: framework,
    displayName: "Done",
    async *run(ctx: RunContext): AsyncGenerator<ArenaEvent> {
      yield {
        type: "thought",
        pipeline: ctx.config.label,
        content: "done",
        turn: ctx.turn,
        runId: ctx.identity.runId,
        timestamp: ctx.clock.now(),
      } as ArenaEvent;
      yield {
        type: "complete",
        pipeline: ctx.config.label,
        metrics: {
          success: true,
          duration_ms: 1,
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          tool_calls: 0,
          steps: 1,
          context_window: 1,
          max_input_tokens: 1,
          max_output_tokens: 1,
          context_usage_pct: 0,
          input_usage_pct: 0,
        },
        turn: ctx.turn,
        runId: ctx.identity.runId,
        timestamp: ctx.clock.now(),
      } as ArenaEvent;
    },
  };
}

interface Harness {
  runner: ArenaRunner;
  /** Swappable column route: lets one test reuse the runner across two runs. */
  route: { columns: PipelineConfig[] };
}

function makeRunner(options: { maxConcurrentColumns?: number } = {}): Harness {
  const runsRoot = mkdtempSync(join(tmpdir(), "arena-column-stop-"));
  roots.push(runsRoot);
  const clock = new SystemClock();
  const workspaceRegistry = new WorkspaceRegistry({ runsRoot, clock });
  const byFramework = new Map<string, AgentDriver>([
    ["stub-hang", hangDriver("stub-hang")],
    ["stub-done", doneDriver("stub-done")],
  ]);
  const route = { columns: [config("col-a", "stub-hang"), config("col-b", "stub-done")] };
  const runner = new ArenaRunner({
    registry: {
      get: (id: string) => byFramework.get(id) ?? hangDriver(id),
      names: new Set(),
    } as unknown as DriverLookup,
    // Structural stub: the runner only calls route()/listDimensionOptions off it.
    router: { route: () => route.columns } as never,
    workspaceRegistry,
    reportPublisher: { publish: async () => null },
    modelFactory: {
      create: () =>
        ({
          llm: { invoke: async () => ({}) },
          llmVendor: null,
          contextWindow: 128_000,
          maxInputTokens: 120_000,
        }) as unknown as ColumnRuntime,
    },
    idGenerator: new RandomIdGenerator(),
    clock,
    maxConcurrentRuns: 2,
    maxConcurrentColumns: options.maxConcurrentColumns,
    breakerThreshold: 1,
  });
  return { runner, route };
}

function request(): ArenaRunRequest {
  return {
    question: "q",
    dimension: "framework",
    selections: ["native"],
    messages: [],
    interactive: false,
  } as unknown as ArenaRunRequest;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met");
}

function liveColumnId(runner: ArenaRunner): string {
  const aborts = (runner as unknown as { columnAborts: Map<string, AbortController> }).columnAborts;
  const id = [...aborts.keys()][0];
  if (id === undefined) throw new Error("no live column");
  return id;
}

describe("ArenaRunner per-column stop (real agent layer)", () => {
  it("reports the stopped column with the stopped marker while siblings finish", async () => {
    const { runner } = makeRunner();
    const events: ArenaEvent[] = [];
    const streaming = (async () => {
      for await (const event of runner.streamParallel(request())) events.push(event);
    })();

    await waitFor(() => (runner as unknown as { columnAborts: Map<string, unknown> }).columnAborts.size > 0);
    expect(runner.stopColumn(liveColumnId(runner))).toBe(true);
    await streaming;

    const stoppedColumn = events.filter((event) => event.pipeline === "col-a");
    // Not a generic endpoint failure: the user stop owns the terminal, which is
    // what the web client matches to render a paused badge instead of an error.
    expect(stoppedColumn.some((event) => event.type === "error" && event.message === "Column stopped by user")).toBe(true);
    expect(stoppedColumn.some((event) => event.type === "error" && event.message === "AbortError")).toBe(false);
    const stoppedComplete = stoppedColumn.find((event) => event.type === "complete");
    expect(stoppedComplete?.metrics?.success).toBe(false);
    // The stop must not be reported as a successful run either.
    expect(stoppedColumn.some((event) => event.type === "complete" && event.metrics?.success === true)).toBe(false);

    // Sibling isolation: the other column streamed and completed normally.
    const siblingComplete = events.find((event) => event.pipeline === "col-b" && event.type === "complete");
    expect(siblingComplete?.metrics?.success).toBe(true);
  }, 30_000);

  it("does not count a stop as an endpoint failure (no breaker short-circuit afterwards)", async () => {
    const { runner, route } = makeRunner();
    // breakerThreshold is 1: one recorded failure is enough to trip the endpoint.
    const first = (async () => {
      for await (const _event of runner.streamParallel(request())) {
        // Drain.
      }
    })();
    await waitFor(() => (runner as unknown as { columnAborts: Map<string, unknown> }).columnAborts.size > 0);
    runner.stopColumn(liveColumnId(runner));
    await first;

    // Both columns of the first run share one endpoint id; a stop counted as a
    // failure would now short-circuit the sibling's next run.
    route.columns = [config("col-b", "stub-done")];
    const second: ArenaEvent[] = [];
    for await (const event of runner.streamParallel(request())) second.push(event);
    expect(second.some((event) => event.type === "error" && event.message.includes("circuit-broken"))).toBe(false);
    expect(second.some((event) => event.type === "complete" && event.pipeline === "col-b")).toBe(true);
  }, 30_000);

  it("releases the column slot so queued columns run after a stop", async () => {
    // One column permit: without a release on the stop path the queued sibling
    // could never start and the drain below would hang.
    const { runner } = makeRunner({ maxConcurrentColumns: 1 });
    const events: ArenaEvent[] = [];
    const streaming = (async () => {
      for await (const event of runner.streamParallel(request())) events.push(event);
    })();

    await waitFor(() => (runner as unknown as { columnAborts: Map<string, unknown> }).columnAborts.size > 0);
    runner.stopColumn(liveColumnId(runner));
    await streaming;
    expect(runner.columnQueueDepth()).toBe(0);
    expect(events.filter((event) => event.type === "complete")).toHaveLength(2);
    expect(events.some((event) => event.pipeline === "col-b" && event.type === "complete" && event.metrics?.success === true)).toBe(true);
  }, 30_000);
});
