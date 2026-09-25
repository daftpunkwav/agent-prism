/**
 * @file arena runner run logs tests
 * @description Locks the runner-side wiring of the per-run observability logs:
 * fail-open initialization, the bounded flush at stream settle, and per-column
 * wire capture through the injected sink.
 *
 * Responsibilities:
 * - Pin that a broken trace dir disables the logs without breaking the run
 * - Pin that event/wire tails are fully on disk once the stream settles
 * - Pin that every column's model factory receives a wire sink bound to its label
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeEvent,
  eventLogFileName,
  wireLogFileName,
  type AgentDriver,
  type ArenaEvent,
  type ArenaRunRequest,
  type ChatMessage,
  type LlmWireRecord,
  type PipelineConfig,
  type PipelineMetrics,
} from "@agentprism/contracts";
import { FrameworkDriverRegistry } from "@agentprism/driver-run-support";
import { WorkspaceRegistry, type Workspace } from "@agentprism/runtime";
import { ArenaRunner } from "@agentprism/arena-runner";

function makeMetrics(): PipelineMetrics {
  return {
    success: true,
    duration_ms: 10,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    tool_calls: 1,
    steps: 1,
    context_window: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 4096,
    context_usage_pct: 0,
    input_usage_pct: 0,
  };
}

function makeRequest(overrides: Partial<ArenaRunRequest> = {}): ArenaRunRequest {
  return {
    question: overrides.question ?? "write snake",
    dimension: "framework",
    selections: ["native", "langchain"],
    messages: overrides.messages ?? [],
    temperature: null,
    baseline: null,
    column_sessions: overrides.column_sessions,
  } as ArenaRunRequest;
}

const LLM_WIRE_REQUEST: LlmWireRecord = {
  kind: "llm_request",
  title: "LLM request → m1 (0 messages)",
  data: { model: "m1", messages: [], tools: [] },
  durationMs: null,
};

/** Driver that fires the column's captured wire sink (simulating the model layer) then completes. */
function makeWireEmittingDriver(sinks: Map<string, (record: LlmWireRecord) => void>): AgentDriver {
  return {
    frameworkId: "fake",
    displayName: "Fake",
    async *run(raw: unknown): AsyncIterable<ArenaEvent> {
      const context = raw as { config: { label: string }; workspace: Workspace; turn: number };
      sinks.get(context.config.label)?.(LLM_WIRE_REQUEST);
      yield completeEvent({
        pipeline: context.config.label,
        workspace: context.workspace.name,
        metrics: makeMetrics(),
        turn: context.turn,
      });
    },
  };
}

interface Harness {
  runner: ArenaRunner;
  workspaces: WorkspaceRegistry;
  create: ReturnType<typeof vi.fn>;
}

const RUNS_ROOT = join(tmpdir(), `aprism-run-logs-${randomUUID()}`);

function makeHarness(driver: AgentDriver, modelFactoryCreate?: Harness["create"]): Harness {
  const registry = new FrameworkDriverRegistry();
  registry.register(driver);
  const workspaces = new WorkspaceRegistry({
    runsRoot: RUNS_ROOT,
    maxWorkspaces: 8,
    ttlSeconds: 3600,
    clock: { now: () => 0 },
  });
  const create =
    modelFactoryCreate ??
    vi.fn(() => ({
      llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
      llmVendor: {},
      contextWindow: 128_000,
      maxInputTokens: 120_000,
    }));
  const runner = new ArenaRunner({
    registry,
    router: {
      route: (): PipelineConfig[] =>
        [
          { label: "Native Agent", endpoint_id: "ep", framework: "fake", harness: "bare" },
          { label: "LangChain", endpoint_id: "ep", framework: "fake", harness: "bare" },
        ] as PipelineConfig[],
    } as never,
    workspaceRegistry: workspaces,
    reportPublisher: { publish: async () => null },
    modelFactory: { create } as never,
    idGenerator: { next: () => randomUUID().slice(0, 8) },
    clock: { now: () => 0 },
    maxConcurrentRuns: 2,
  });
  return { runner, workspaces, create };
}

async function drain(runner: ArenaRunner, request?: ArenaRunRequest): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of runner.streamParallel(request ?? makeRequest())) events.push(event);
  return events;
}

describe("ArenaRunner run logs wiring", () => {
  mkdirSync(RUNS_ROOT, { recursive: true });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(RUNS_ROOT, { recursive: true, force: true });
    mkdirSync(RUNS_ROOT, { recursive: true });
  });

  it("keeps the run alive and warns once when the trace dir cannot be created", async () => {
    const { runner, workspaces } = makeHarness(makeWireEmittingDriver(new Map()));
    (workspaces as unknown as { traceDir: (runId: string) => string }).traceDir = () => {
      throw new Error("sick disk");
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = await drain(runner);

    expect(events.some((e) => e.type === "complete" && e.pipeline === "Native Agent")).toBe(true);
    expect(events.some((e) => e.type === "complete" && e.pipeline === "LangChain")).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("run log init failed");
  });

  it("has the event tail fully on disk the moment the stream settles", async () => {
    const { runner, workspaces } = makeHarness(makeWireEmittingDriver(new Map()));

    const events = await drain(runner);

    // No explicit flush here: the settle-time bounded flush must have drained
    // every fire-and-forget append before the generator returned.
    const ws = events.find((e) => e.type === "complete" && e.pipeline === "Native Agent")?.workspace;
    expect(ws).toBeTruthy();
    const runId = workspaces.runIdOf(ws!);
    expect(runId).not.toBeNull();
    const file = join(workspaces.traceDir(runId!), eventLogFileName("Native Agent"));
    const lines = readFileSync(file, "utf-8").split("\n").filter((line) => line !== "");
    const last = JSON.parse(lines.at(-1)!) as { type: string; pipeline: string };
    expect(last.type).toBe("complete");
    expect(last.pipeline).toBe("Native Agent");
  });

  it("hands every column's factory a wire sink and lands records in that column's wire log", async () => {
    const sinks = new Map<string, (record: LlmWireRecord) => void>();
    const driver = makeWireEmittingDriver(sinks);
    const create = vi.fn(
      (config: PipelineConfig, options?: { wireSink?: (record: LlmWireRecord) => void }) => {
        if (options?.wireSink !== undefined) sinks.set(config.label, options.wireSink);
        return {
          llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
          llmVendor: {},
          contextWindow: 128_000,
          maxInputTokens: 120_000,
        };
      },
    );
    const { runner, workspaces } = makeHarness(driver, create);

    // One prior exchange in the shared history: the column's wire rows carry turn 2.
    const history: ChatMessage[] = [
      { role: "user", content: "write snake" },
      { role: "assistant", content: "created snake.py" },
      { role: "user", content: "add a scoreboard" },
    ];
    const events = await drain(runner, makeRequest({ messages: history }));

    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls as Array<[PipelineConfig, { wireSink?: unknown }]>) {
      expect(typeof call[1]?.wireSink).toBe("function");
    }

    const ws = events.find((e) => e.type === "complete" && e.pipeline === "Native Agent")?.workspace;
    const runId = workspaces.runIdOf(ws!);
    expect(runId).not.toBeNull();
    const file = join(workspaces.traceDir(runId!), wireLogFileName("Native Agent"));
    const rows = readFileSync(file, "utf-8").split("\n").filter((line) => line !== "");
    expect(rows).toHaveLength(1);
    const entry = JSON.parse(rows[0]!) as { seq: number; ts: number; turn: number; record: LlmWireRecord };
    expect(entry.seq).toBe(0);
    expect(entry.turn).toBe(2);
    expect(entry.record.kind).toBe("llm_request");
    // The other column's wire log exists separately (per-label attribution).
    expect(readFileSync(join(workspaces.traceDir(runId!), wireLogFileName("LangChain")), "utf-8")).toContain(
      '"kind":"llm_request"',
    );
  });
});
