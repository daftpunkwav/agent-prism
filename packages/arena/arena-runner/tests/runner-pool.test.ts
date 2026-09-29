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
  ReportPublisher,
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

function makeRunner(overrides?: {
  breakerThreshold?: number;
  eventRetention?: number;
  reportPublisher?: ReportPublisher;
  /** Report a failed model call when the factory builds a runtime (endpoint health). */
  reportModelFailure?: boolean;
  /** Harness retry caps the settings knobs feed the runner (forwarded into the agent spec). */
  harnessMaxRetries?: Partial<Record<"verify" | "reflect" | "self_evolve", number>>;
}): ArenaRunner {
  return new ArenaRunner({
    drivers: { get: () => ({}), names: new Set() } as unknown as DriverLookup,
    router: { route: () => [config("col-a")] },
    workspaceRegistry: {
      traceDir: () => {
        throw new Error("no fs in tests");
      },
    },
    reportPublisher: overrides?.reportPublisher ?? { publish: async () => null },
    modelRuntime: {
      create: (_config: unknown, options?: { onModelCall?: (outcome: { ok: boolean; error?: unknown }) => void }) => {
        if (overrides?.reportModelFailure === true) options?.onModelCall?.({ ok: false, error: new Error("llm timeout") });
        return {};
      },
    },
    idGenerator: (() => {
      let n = 0;
      return { next: () => `id-${(n += 1)}` };
    })(),
    clock: { now: () => 1_700_000_000_000 },
    maxConcurrentRuns: 2,
    breakerThreshold: overrides?.breakerThreshold ?? 1,
    eventRetention: overrides?.eventRetention,
    askUserWaitMs: 60_000,
    harnessMaxRetries: overrides?.harnessMaxRetries,
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
  it("derives the turn from user-message count, not strict pair counting", async () => {
    runMock.mockImplementation(async function* () {
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 3 };
    } as never);
    const runner = makeRunner();
    // Not strictly alternating (two user messages, odd length): pair-counting
    // would say turn 2, but two questions have been asked, so the run is turn 3.
    const messages = [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
      { role: "assistant", content: "late reply" },
    ];
    await drain(runner, request({ messages } as never));
    const spec = runMock.mock.calls[0]?.[1] as { turn: number; history: unknown };
    expect(spec.turn).toBe(3);
    expect(spec.history).toEqual(messages);
  });

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

  it("retains exactly the newest events per column for the comparison report", async () => {
    // The cap evicts from the head after every push: the bucket handed to the report
    // must hold the newest `eventRetention` events in arrival order. A first-N slice
    // would keep the head and lose the terminal complete (the tail is what workspace
    // resolution and the report read).
    runMock.mockImplementation((async function* () {
      for (let step = 1; step <= 10; step += 1) {
        yield { type: "thought_delta", pipeline: "col-a", turn: 1, step, content: `delta-${step}` };
      }
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 1 };
    }) as never);
    const captured: Array<Record<string, ArenaEvent[]>> = [];
    const reportPublisher: ReportPublisher = {
      publish: async (input) => {
        captured.push(input.eventsByPipeline);
        return null;
      },
    };
    const runner = makeRunner({ eventRetention: 3, reportPublisher });
    await drain(runner, request());
    const retained = captured[0]?.["col-a"] ?? [];
    expect(retained.map((event) => event.type)).toEqual(["thought_delta", "thought_delta", "complete"]);
    expect(
      retained.filter((event) => event.type === "thought_delta").map((event) => event.content),
    ).toEqual(["delta-9", "delta-10"]);
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

  it("counts a reported model-call failure toward the breaker and short-circuits the next run", async () => {
    const runner = makeRunner({ breakerThreshold: 1, reportModelFailure: true });
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

  it("counts a driver-reported model-call failure toward the endpoint", async () => {
    // The Claude Agent SDK column has no chat-model callbacks: its driver reports through
    // the execution context. This locks that second path into the same breaker.
    const runner = makeRunner({ breakerThreshold: 1 });
    runMock.mockImplementation((async function* (_deps: unknown, spec: { onModelCall?: (outcome: { ok: boolean }) => void }) {
      expect(spec.onModelCall).toBeDefined();
      spec.onModelCall?.({ ok: false });
      yield { type: "error", pipeline: "col-a", message: "claude run failed", turn: 1 };
      yield { type: "complete", pipeline: "col-a", metrics: { ...METRICS, success: false }, turn: 1 };
    }) as never);

    await drain(runner, request());
    // Threshold 1 and a reported failure: the next run never reaches the agent layer.
    const second = await drain(runner, request());
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(second.some((event) => event.type === "error" && /circuit-broken/.test(event.message))).toBe(true);
  });

  it("does not count a driver-level column failure toward the endpoint", async () => {
    const runner = makeRunner({ breakerThreshold: 1 });
    runMock.mockImplementation(async function* () {
      yield { type: "error", pipeline: "col-a", message: "driver bug", turn: 1 };
      yield { type: "complete", pipeline: "col-a", metrics: { ...METRICS, success: false }, turn: 1 };
    } as never);
    await drain(runner, request());
    // No model call ever failed here: a column that fails on its own must not take
    // the shared endpoint down for the columns that are healthy.
    const second = await drain(runner, request());
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(second.some((event) => event.type === "error" && /circuit-broken/.test(event.message))).toBe(false);
  });

  it("forwards the harness retry knobs into the agent spec", async () => {
    // The settings harness-retry knobs reach the verification loop only through this
    // spec field: dropping the pass-through would silently restore the built-in caps
    // and no other test would notice.
    let seen: { harnessMaxRetries?: unknown } | undefined;
    runMock.mockImplementation((async function* (_deps: unknown, spec: { harnessMaxRetries?: unknown }) {
      seen = spec;
      yield { type: "complete", pipeline: "col-a", metrics: METRICS, turn: 1 };
    }) as never);
    const runner = makeRunner({ harnessMaxRetries: { verify: 3, self_evolve: 2 } });
    await drain(runner, request());
    expect(seen?.harnessMaxRetries).toEqual({ verify: 3, self_evolve: 2 });
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
