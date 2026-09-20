/**
 * @file arena runner pool tests
 * @description Locks the parallel run pool: event merge, breaker short-circuit, human channel, and per-column stop.
 *
 * The agent-execution layer is a scripted async generator; the pool machinery
 * (channel merge, breakers, ask registry, abort fan-out) runs for real.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArenaEvent,
  ArenaRunRequest,
  DriverLookup,
  PipelineConfig,
  PipelineMetrics,
} from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { ArenaRunner } from "../src/runner.js";

vi.mock("@agentprism/agent", () => ({
  runAgentExecution: vi.fn(),
}));

const { runAgentExecution } = await import("@agentprism/agent");
const runMock = vi.mocked(runAgentExecution);

const METRICS: PipelineMetrics = {
  success: true,
  duration_ms: 5,
  input_tokens: 1,
  output_tokens: 1,
  total_tokens: 2,
  tool_calls: 0,
  steps: 1,
  context_window: 1000,
  max_input_tokens: 900,
  max_output_tokens: 100,
  context_usage_pct: 0.1,
  input_usage_pct: 0.1,
};

function config(label: string): PipelineConfig {
  return PipelineConfigSchema.parse({ label, framework: "native" });
}

function makeRunner(overrides?: { breakerThreshold?: number }): ArenaRunner {
  return new ArenaRunner({
    registry: { get: () => ({}), names: new Set() } as unknown as DriverLookup,
    router: { route: () => [config("col-a")] },
    workspaceRegistry: {
      traceDir: () => {
        throw new Error("no fs in tests");
      },
    },
    reportPublisher: { publish: async () => null },
    modelFactory: { create: () => ({}) },
    idGenerator: (() => {
      let n = 0;
      return { next: () => `id-${(n += 1)}` };
    })(),
    clock: { now: () => 1_700_000_000_000 },
    maxConcurrentRuns: 2,
    breakerThreshold: overrides?.breakerThreshold ?? 1,
    askUserWaitMs: 60_000,
  } as never);
}

function request(overrides?: Partial<ArenaRunRequest>): ArenaRunRequest {
  return {
    question: "q",
    dimension: "framework",
    selections: ["native"],
    messages: [],
    interactive: false,
    ...overrides,
  } as ArenaRunRequest;
}

afterEach(() => {
  // restoreAllMocks no longer resets vi.fn() history in Vitest 4; call counts
  // are part of what these tests assert.
  vi.clearAllMocks();
});

async function drain(runner: ArenaRunner, req: ArenaRunRequest): Promise<ArenaEvent[]> {
  const out: ArenaEvent[] = [];
  for await (const event of runner.streamParallel(req)) {
    out.push(event);
  }
  return out;
}

describe("ArenaRunner.streamParallel", () => {
  it("merges column events and ends without a report when the publisher yields null", async () => {
    runMock.mockImplementation(async function* () {
      yield { type: "step_start", pipeline: "col-a", turn: 1, step: 1 };
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 1 };
    } as never);
    const runner = makeRunner();
    const events = await drain(runner, request());
    expect(events.map((event) => event.type)).toEqual(["step_start", "complete"]);
    expect(runMock).toHaveBeenCalledOnce();
  });

  it("normalizes empty labels and applies the temperature override outside the temperature dimension", () => {
    const runner = makeRunner();
    (runner as unknown as { deps: { router: { route: () => PipelineConfig[] } } }).deps.router.route = () => [
      config(""),
      config("col-b"),
    ];
    const configs = runner.configsFor({ ...request(), temperature: 0.3 } as ArenaRunRequest);
    expect(configs.map((c) => c.label)).toEqual(["native", "col-b"]);
    expect(configs.every((c) => c.temperature === 0.3)).toBe(true);
  });

  it("counts an in-column error toward the breaker and short-circuits the next run", async () => {
    const runner = makeRunner({ breakerThreshold: 1 });
    runMock.mockImplementation(async function* () {
      yield { type: "error", pipeline: "col-a", message: "llm timeout", turn: 1 };
      yield { type: "complete", pipeline: "col-a", metrics: { ...METRICS, success: false }, turn: 1 };
    } as never);
    const first = await drain(runner, request());
    expect(first.some((event) => event.type === "error")).toBe(true);

    // The endpoint tripped (threshold 1): the next run never reaches the agent layer.
    const second = await drain(runner, request());
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(second.some((event) => event.type === "error" && /circuit-broken/.test(event.message))).toBe(true);
    expect(runner.breakerCount()).toBe(1);
  });

  it("delivers human answers through the ask registry when the column waits", async () => {
    const runner = makeRunner();
    let capturedAsk: ((questions: never[], signal?: AbortSignal) => Promise<unknown>) | undefined;
    let capturedAgentId = "";
    runMock.mockImplementation((async function* (_deps: unknown, opts: { agentId: string; askUser?: never }) {
      capturedAgentId = opts.agentId;
      capturedAsk = opts.askUser as unknown as typeof capturedAsk;
      yield { type: "step_start", pipeline: "col-a", turn: 1, step: 1 };
      const reply = (await capturedAsk?.([{ id: "q1", header: "", question: "Proceed?", options: ["yes"] }] as never)) as {
        answered: boolean;
        answers: Array<{ id: string; answer: string }>;
      };
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 1, content: JSON.stringify(reply) } as never;
    }) as never);
    const runner2 = runner;
    const streaming = (async () => {
      const out: ArenaEvent[] = [];
      for await (const event of runner2.streamParallel(request({ interactive: true }))) {
        out.push(event);
      }
      return out;
    })();

    await waitForCondition(() => runner.listPendingAsks().length === 1);
    expect(runner.pendingAsk(capturedAgentId)[0]?.id).toBe("q1");
    expect(runner.answerQuestion("nope", "q1", "yes")).toBe(false);
    expect(runner.answerQuestion(capturedAgentId, "unknown", "yes")).toBe(false);
    expect(runner.answerQuestion(capturedAgentId, "q1", "yes")).toBe(true);
    // Answered: the batch clears and the column settles.
    await waitForCondition(() => runner.pendingAsk(capturedAgentId).length === 0);
    const events = await streaming;
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("stops one live column through its agent id and reports the miss for unknown ids", async () => {
    const runner = makeRunner();
    let capturedAgentId = "";
    let capturedSignal: AbortSignal | undefined;
    runMock.mockImplementation((async function* (_deps: unknown, opts: { agentId: string; signal: AbortSignal }) {
      capturedAgentId = opts.agentId;
      capturedSignal = opts.signal;
      yield { type: "step_start", pipeline: "col-a", turn: 1, step: 1 };
      await new Promise((resolve) => {
        opts.signal.addEventListener("abort", resolve, { once: true });
      });
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 1 };
    }) as never);
    expect(runner.stopColumn("ghost")).toBe(false);
    const streaming = drain(runner, request());
    await waitForCondition(() => capturedAgentId !== "");
    expect(runner.stopColumn(capturedAgentId)).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    const events = await streaming;
    expect(events.at(-1)?.type).toBe("complete");
  });
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met");
}
